// Адаптер Together AI Realtime API для «жанра» стрим-ASR-моделей: и Nemotron 3.5, и Whisper
// large-v3 отдаются через один и тот же wss-эндпоинт, различие только в query-параметре model —
// поэтому файл называется nemotron.ts (по брифу Задачи 3), но экспортирует общую фабрику
// createTogetherRunner, а createNemotronRunner — тонкая обёртка над ней для совместимости.
//
// Разведка (Задача 3, шаг 3, --seconds 20 --raw) показала: соединение открывается без
// какого-либо конфигурационного сообщения перед аудио (никакого transcription_session.update
// не требуется для старта) — Nemotron распознаёт русский сразу же после первого аудио-чанка
// даже без явного языка. Сервер отдаёт кадры в стиле OpenAI Realtime:
//   session.created — один раз сразу после открытия соединения;
//   conversation.item.input_audio_transcription.delta — партиал, накопительный текст сегмента
//     лежит в поле delta, есть item_id/start/duration;
//   conversation.item.input_audio_transcription.completed — финал сегмента, текст лежит в
//     поле transcript (не delta!), те же item_id/start/duration.
// Ни invalid_input_audio_format, ни ошибок про язык не было — все три исхода шага 3 брифа
// свелись к исходу №1 (кадры с транскриптом есть).
//
// Уточнения по факту доки Together (docs.together.ai/reference/audio-transcriptions-realtime
// + openapi.yaml схема AudioTranscriptionRequest), сверенной после первых прогонов:
// - input_audio_format нужно передавать как `pcm_s16le_16000`, а не `pcm16` — последнее сервер
//   тоже принимает без ошибки (никакого invalid_input_audio_format не было), но задокументированное
//   значение — первое, используем его.
// - VAD (voice activity detection) режет аудио на сегменты сам, и с дефолтами Together
//   (min_silence_duration_ms=500, max_speech_duration_s=5.0) для телефонных звонков с паузами
//   внутри фразы это рвёт речь каждые 5 секунд и на любой полусекундной тишине — отсюда мусорные
//   обрывки ("Робот себе", "в франтей Никиту") и точки на месте пауз в самом первом прогоне.
//   Настраиваем VAD через query (сервер принял её без ошибок, сообщение
//   transcription_session.update не потребовалось): turn_detection=server_vad, threshold=0.15,
//   min_silence_duration_ms=3000, max_speech_duration_s=30, speech_pad_ms=300 — паузы внутри
//   фразы переживают, сегмент не рубится на середине слова. Пробовали более агрессивные значения
//   (threshold=0.05, min_speech_duration_ms=50, speech_pad_ms=500), чтобы вернуть проглоченное
//   самое начало звонка («Алло. Алло. Всем привет.» у Deepgram) — результат не изменился, значит
//   это не VAD режет короткие реплики, а сама модель их не распознаёт на первых секундах потока.
// - `language` в query — обязателен для Whisper: без него `openai/whisper-large-v3` на этом же
//   эндпоинте не транскрибирует, а переводит русскую речь на английский (классическое поведение
//   Whisper при отсутствии заданного языка). Формальная схема параметров realtime-эндпоинта в
//   openapi.yaml содержит только `model`/`input_audio_format`, но `language` — задокументированное
//   поле батчевого POST /audio/transcriptions (ISO 639-1, например `ru`); в query realtime-эндпоинта
//   оно тоже сработало без ошибок. Nemotron транскрибирует русский и без `language` (авто-детект),
//   но применяем его к обеим моделям одинаково — сравнение должно быть в равных условиях.

import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { SmokeRunner } from '../types.js';

export const NEMOTRON_MODEL = 'nvidia/nemotron-3.5-asr-streaming-0.6b';
export const WHISPER_MODEL = 'openai/whisper-large-v3';

function getApiKey(): string {
  const key = process.env.TOGETHER_API_KEY;
  if (!key) throw new Error('TOGETHER_API_KEY environment variable is not set');
  return key;
}

// VAD одинаковый для всех моделей этого эндпоинта — сравнение должно быть в равных условиях.
const VAD_PARAMS = 'turn_detection=server_vad&threshold=0.15&min_silence_duration_ms=3000&max_speech_duration_s=30&speech_pad_ms=300';

/**
 * Превращает кадр Together в наше событие. Имена полей — по факту разведки (шаг 3):
 * текст партиала лежит в `delta`, текст финала — в `transcript` (не `delta`), позиция и
 * длительность сегмента — в `start`/`duration` у обоих типов кадров.
 */
function toSmokeEvent(frame: unknown): { isFinal: boolean; text: string; audioPosSec?: number; durationSec?: number } | null {
  const f = frame as { type?: string; delta?: string; transcript?: string; start?: number; duration?: number };
  if (f?.type !== 'conversation.item.input_audio_transcription.delta'
    && f?.type !== 'conversation.item.input_audio_transcription.completed') {
    return null;
  }
  const isFinal = f.type === 'conversation.item.input_audio_transcription.completed';
  const text = isFinal ? f.transcript ?? '' : f.delta ?? '';
  if (!text.trim()) return null;
  return { isFinal, text, audioPosSec: f.start, durationSec: f.duration };
}

/** Кадр типа `session.created` — ожидаемый служебный кадр, не транскрипт и не повод для warning. */
const EXPECTED_NON_EVENT_TYPES = new Set(['session.created']);

/** `type` кадра указывает на ошибку сервера (например `error`, `response.failed`). */
function isErrorFrameType(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return t.includes('error') || t.includes('failed');
}

/** Вытаскивает текст ошибки из кадра в формате OpenAI/Together Realtime ({ error: { message } }) или похожем. */
function errorFrameMessage(frame: unknown): string {
  const f = frame as { error?: { message?: string; code?: string } | string; message?: string };
  if (typeof f?.error === 'string') return f.error;
  if (f?.error?.message) return f.error.code ? `${f.error.code}: ${f.error.message}` : f.error.message;
  if (f?.message) return f.message;
  return JSON.stringify(frame);
}

/** Общая фабрика для любой модели транскрипции на Together Realtime API. */
export function createTogetherRunner(model: string, language: string, opts: { raw: boolean; outDir: string }): SmokeRunner {
  let socket: WebSocket | null = null;
  let rawStream: ReturnType<typeof createWriteStream> | null = null;
  const rawFileName = `${model.replace(/[^a-z0-9]+/gi, '-')}-raw.jsonl`;
  // Каждый неопознанный тип кадра — предупреждение один раз, а не на каждое сообщение
  // (иначе смена схемы сервера залила бы консоль сотнями одинаковых строк за секунды).
  const warnedFrameTypes = new Set<string>();

  return {
    async start(onEvent) {
      const url = `wss://api.together.ai/v1/realtime?model=${encodeURIComponent(model)}&input_audio_format=pcm_s16le_16000&language=${encodeURIComponent(language)}&${VAD_PARAMS}`;
      socket = new WebSocket(url, { headers: { Authorization: `Bearer ${getApiKey()}` } });

      if (opts.raw) {
        mkdirSync(opts.outDir, { recursive: true });
        rawStream = createWriteStream(join(opts.outDir, rawFileName), { encoding: 'utf8' });
      }

      await new Promise<void>((resolve, reject) => {
        socket!.once('open', () => resolve());
        socket!.once('error', (err) => reject(new Error(`Together WS failed: ${err.message}`)));
      });

      // Постоянные обработчики (в отличие от once-версий выше, которые нужны были только на
      // время ожидания открытия). Без них обрыв соединения посреди прогона выглядел бы как
      // деградация качества модели (события просто перестают приходить), а не как сетевая
      // проблема — печатаем код/причину явно.
      socket.on('error', (err) => {
        console.error(`[together] WebSocket error после открытия: ${err.message}`);
      });
      socket.on('close', (code, reason) => {
        console.error(`[together] WebSocket закрыт: code=${code} reason=${reason.toString() || '(нет)'}`);
      });

      socket.on('message', (data) => {
        const text = data.toString();
        rawStream?.write(`${text}\n`);
        let frame: unknown;
        try {
          frame = JSON.parse(text);
        } catch {
          return;
        }

        const frameType = (frame as { type?: string })?.type;
        if (isErrorFrameType(frameType)) {
          console.error(`[together] сервер вернул ошибку (type=${frameType}): ${errorFrameMessage(frame)}`);
          return;
        }

        const event = toSmokeEvent(frame);
        if (event) {
          onEvent(event);
          return;
        }

        if (frameType && !EXPECTED_NON_EVENT_TYPES.has(frameType) && !warnedFrameTypes.has(frameType)) {
          warnedFrameTypes.add(frameType);
          console.warn(`[together] неизвестный тип кадра: ${frameType} — сервер мог сменить схему`);
        }
      });
    },

    send(chunk) {
      socket?.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') }));
    },

    async finish(trailingMs) {
      await new Promise((resolve) => setTimeout(resolve, trailingMs));
      rawStream?.end();
      socket?.close();
      socket = null;
    },
  } satisfies SmokeRunner;
}

export function createNemotronRunner(language: string, opts: { raw: boolean; outDir: string }): SmokeRunner {
  return createTogetherRunner(NEMOTRON_MODEL, language, opts);
}

export function createWhisperRunner(language: string, opts: { raw: boolean; outDir: string }): SmokeRunner {
  return createTogetherRunner(WHISPER_MODEL, language, opts);
}
