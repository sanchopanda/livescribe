// Deepgram STT implementation using @deepgram/sdk
// Documentation: https://developers.deepgram.com/docs

import type { STTProvider, STTResult, STTResultCallback, STTStatus } from './types.js';
import { createClient } from '@deepgram/sdk';
import { createStreamClock, type StreamClock } from './stream-clock.js';
import { isActiveConnection } from './connection-guard.js';
import { shouldReconnect, type ConnectionState } from './connection-state.js';
import { createConnectWatchdog, type ConnectWatchdog } from './connect-watchdog.js';
import { createReconnectBackoff, type ReconnectBackoff } from './reconnect-backoff.js';

// LS-31: диагностика гонки реконнекта, включается только через переменную
// окружения — постоянный инструмент, не временные console.log на выброс.
function debugReconnect(label: string): void {
  if (!process.env.STT_DEBUG_RECONNECT) {
    return;
  }
  console.log(`[dg ${Date.now()}] ${label}`);
}

export class DeepgramSTT implements STTProvider {
  private language: string = 'ru';
  private initialized = false;

  private deepgramClient: ReturnType<typeof createClient> | null = null;
  private connection: any = null;
  private onResultCallback: STTResultCallback | null = null;
  private partialResults: STTResult[] = [];
  private finalResults: STTResult[] = [];
  private audioBuffer: Buffer[] = [];
  // LS-31: заменяет булев connectionOpen — различает "открывается" и "умерло",
  // чтобы processAudio() не пытался реконнектиться во время самого первого
  // открытия соединения (см. connection-state.ts).
  private connectionState: ConnectionState = 'closed';
  private langCode: string = 'en';
  private deepgramModel: string = 'nova-3';
  private static readonly MAX_BUFFERED_CHUNKS = 400;
  // LS-31 (доделка): @deepgram/sdk не даёт собственного connect-таймаута —
  // без сторожевого таймера 'connecting' может провисеть вечно, если
  // транспорт не эмитит вообще ничего (см. connect-watchdog.ts).
  private static readonly CONNECT_TIMEOUT_MS = 8000;
  private readonly connectWatchdog: ConnectWatchdog = createConnectWatchdog({
    timeoutMs: DeepgramSTT.CONNECT_TIMEOUT_MS,
  });
  // Сквозная шкала времени сессии: сглаживает сброс startSec к нулю
  // при каждом реконнекте к Deepgram (см. LS-30).
  private readonly streamClock: StreamClock = createStreamClock();
  // LS-04: реконнект теперь планируется через setTimeout с растущей задержкой
  // (см. reconnect-backoff.ts), а не выполняется немедленно на каждый чанк
  // аудио, который приходит пока соединение не 'open' — иначе при недоступном
  // Deepgram каждый чанк (~каждые 100мс) порождал новую попытку подключения.
  // Реконнект НЕ прекращается сам по себе: после RECONNECT_MAX_ATTEMPTS
  // подряд неудач (растущая фаза 500..8000мс) backoff переходит на постоянный
  // редкий интервал (30с) и продолжает пытаться бесконечно — см. комментарий
  // в reconnect-backoff.ts про то, почему полная остановка была регрессом.
  private readonly reconnectBackoff: ReconnectBackoff = createReconnectBackoff();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // finalize() закрывает соединение НАРОЧНО (конец сессии) — 'close', который
  // за этим следует, не должен планировать реконнект. Без этого флага
  // нормальный, успешный сценарий на finalize()+destroy() тоже получал бы
  // лишнее (но живое, платное) соединение к Deepgram прямо перед уничтожением
  // провайдера — именно это показал сквозной прогон с настоящим ключом. Один
  // раз выставленный, не сбрасывается обратно (инстанс всё равно выбрасывается
  // после destroy() — см. там же).
  private stopping = false;
  private statusCallback: ((status: STTStatus) => void) | null = null;
  private lastEmittedStatus: STTStatus | null = null;

  /**
   * Подписка на статус соединения (LS-04). Не вызывается сразу с текущим
   * статусом — до первого события подписчик по умолчанию считает всё 'ok',
   * что совпадает с реальностью на момент initialize() (соединение только
   * начинает открываться, ничего не сломано).
   */
  onStatusChange(cb: (status: STTStatus) => void): void {
    this.statusCallback = cb;
  }

  private emitStatus(status: STTStatus): void {
    // Дребезг гасим уже здесь: 'open' может сработать один раз, но
    // reset()/emitStatus('ok') вызываются из одного места, так что задача
    // этой проверки — не более чем defensive dedup на случай будущих правок.
    if (this.lastEmittedStatus === status) {
      return;
    }
    this.lastEmittedStatus = status;
    this.statusCallback?.(status);
  }

  private getApiKey(): string {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPGRAM_API_KEY environment variable is not set');
    }
    return apiKey;
  }

  private getLanguageCode(language: string): string {
    const langMap: Record<string, string> = {
      'ru': 'ru',
      'ru-ru': 'ru',
      'en': 'en',
      'en-us': 'en',
      'en-gb': 'en',
      'tr': 'tr',
      'tr-tr': 'tr',
      'es': 'es',
      'es-es': 'es',
      'fr': 'fr',
      'fr-fr': 'fr',
      'de': 'de',
      'de-de': 'de',
      'it': 'it',
      'it-it': 'it',
      'pt': 'pt',
      'pt-br': 'pt',
      'ja': 'ja',
      'ja-jp': 'ja',
      'ko': 'ko',
      'ko-kr': 'ko',
      'zh': 'zh',
      'zh-cn': 'zh',
    };

    const lang = language.toLowerCase();
    return langMap[lang] || 'en';
  }

  private getModel(): string {
    const model = process.env.DEEPGRAM_MODEL?.trim();
    return model || 'nova-3';
  }

  async initialize(language: string, onResult?: STTResultCallback): Promise<void> {
    if (this.initialized && this.language === language) {
      if (onResult) {
        this.onResultCallback = onResult;
      }
      return;
    }

    try {
      this.language = language;
      this.onResultCallback = onResult || null;
      this.langCode = this.getLanguageCode(language);
      this.deepgramModel = this.getModel();
      const apiKey = this.getApiKey();

      // console.log(`Initializing Deepgram STT for language: ${langCode}`);
      // console.log(`Deepgram callback ${this.onResultCallback ? 'is set' : 'is NOT set'}`);

      this.deepgramClient = createClient(apiKey);
      this.createConnection();

      this.initialized = true;
      // console.log('Deepgram STT initialized successfully');
    } catch (err) {
      // console.error('Failed to initialize Deepgram:', err);
      throw new Error(`Deepgram initialization failed: ${(err as Error).message}`);
    }
  }

  private createConnection(): void {
    if (!this.deepgramClient) {
      throw new Error('Deepgram client is not initialized');
    }

    const connection = this.deepgramClient.listen.live({
      model: this.deepgramModel,
      language: this.langCode,
      smart_format: true,
      punctuate: true,
      interim_results: true,
      endpointing: 300,
      diarize: false,
      sample_rate: 16000,
      channels: 1,
      encoding: 'linear16',
    });

    this.connection = connection;
    // Сразу после создания соединение "открывается", а не "открыто" — до
    // события 'open' аудио должно копиться в audioBuffer, а не провоцировать
    // tryReconnect() (LS-31).
    this.connectionState = 'connecting';

    // Сторожевой таймер: если за CONNECT_TIMEOUT_MS транспорт не эмитнет ни
    // 'open', ни 'close'/'error' (файрвол молча роняет пакеты, зависший
    // TCP-хендшейк), состояние 'connecting' иначе провисело бы вечно —
    // shouldReconnect() при 'connecting' всегда false, и tryReconnect()
    // навсегда стал бы no-op. start() сам отменяет предыдущий таймер, так что
    // он не переживает смену соединения.
    this.connectWatchdog.start(() => {
      if (!isActiveConnection(this.connection, connection)) {
        return;
      }
      debugReconnect('WATCHDOG_TIMEOUT');
      this.connectionState = 'closed';
      this.scheduleReconnect();
    });

    connection.on('open', () => {
      // Событие может прийти от соединения, которое реконнект уже вытеснил
      // (this.connection указывает на более новое) — тогда его нельзя
      // применять к живому состоянию.
      if (!isActiveConnection(this.connection, connection)) {
        return;
      }
      debugReconnect('open');
      this.connectWatchdog.cancel();
      this.connectionState = 'open';
      this.flushBufferedAudio();
      // Успешное открытие — прошлая серия неудач не имеет значения для
      // следующего разрыва, шкала задержек должна начаться заново с 500мс.
      this.reconnectBackoff.reset();
      this.emitStatus('ok');
    });

    connection.on('error', () => {
      if (!isActiveConnection(this.connection, connection)) {
        return;
      }
      debugReconnect('error');
      this.connectWatchdog.cancel();
      this.connectionState = 'closed';
      this.scheduleReconnect();
    });

    connection.on('warning', () => {
      // ignore warning
    });

    connection.on('metadata', () => {
      // ignore metadata
    });

    const processResults = (data: any) => {
      // Соединение, к которому привязан этот обработчик, уже не текущее — значит,
      // tryReconnect() успел его заменить, и это результат от старого соединения,
      // догоняющий по сети. Он дублирует то, что распознаёт новое соединение, и
      // офсет-шкала (stream-clock.ts) для него не подходит: offset уже посчитан
      // для НОВОГО соединения, а не для того, что прислало этот результат.
      // Отбрасываем целиком, не давая ему исказить монотонность startSec (LS-30).
      if (!isActiveConnection(this.connection, connection)) {
        return;
      }

      try {
        const payload = typeof data === 'string' ? JSON.parse(data) : data;

        if (!payload || (payload.type && payload.type !== 'Results' && !payload.channel)) {
          return;
        }

        const alternative = payload.channel?.alternatives?.[0];
        const transcript = alternative?.transcript || '';
        const isFinal = payload.is_final === true;
        const confidence = alternative?.confidence;

        if (transcript && transcript.trim()) {
          const defaultResult: STTResult = {
            text: transcript.trim(),
            isFinal,
            confidence,
            language: this.langCode,
            // Offsets into the stream — used to attribute the segment to the speaker who was
            // active when it was spoken, not when it arrived. Смещение переводит startSec
            // текущего (возможно, N-го после реконнекта) соединения в шкалу всей сессии.
            startSec: this.streamClock.toSessionSec(
              typeof payload.start === 'number' ? payload.start : undefined,
            ),
            durationSec: typeof payload.duration === 'number' ? payload.duration : undefined,
          };

          if (isFinal) {
            this.finalResults.push(defaultResult);
          } else {
            this.partialResults.push(defaultResult);
          }

          if (this.onResultCallback) {
            this.onResultCallback(defaultResult);
          }
        }
      } catch {
        // ignore parse/result errors
      }
    };

    connection.on('Results', processResults);
    connection.on('results', processResults);
    connection.on('transcript', processResults);
    connection.on('message', (data: any) => {
      processResults(data);
    });

    connection.on('close', () => {
      if (!isActiveConnection(this.connection, connection)) {
        return;
      }
      debugReconnect('close');
      this.connectWatchdog.cancel();
      this.connectionState = 'closed';
      this.scheduleReconnect();
    });
  }

  private flushBufferedAudio(): void {
    if (!this.connection || this.connectionState !== 'open' || this.audioBuffer.length === 0) {
      return;
    }

    const buffered = this.audioBuffer.splice(0, this.audioBuffer.length);
    for (const chunk of buffered) {
      try {
        this.connection.send(new Uint8Array(chunk));
        // Считаем байты только для успешно отправленных чанков — то, что
        // не ушло в сокет, останется в audioBuffer и уйдёт в следующее
        // соединение, попав в его шкалу с нуля (см. markReconnect).
        this.streamClock.addSentBytes(chunk.length);
      } catch {
        this.audioBuffer.unshift(chunk);
        break;
      }
    }
  }

  private queueAudioChunk(chunk: Buffer): void {
    this.audioBuffer.push(chunk);
    if (this.audioBuffer.length > DeepgramSTT.MAX_BUFFERED_CHUNKS) {
      this.audioBuffer.splice(0, this.audioBuffer.length - DeepgramSTT.MAX_BUFFERED_CHUNKS);
    }
  }

  /**
   * Планирует следующую попытку реконнекта через setTimeout с задержкой из
   * reconnect-backoff.ts, вместо немедленного вызова (LS-04). Вызывается из
   * обработчиков transport-событий (close/error/watchdog-timeout), а не из
   * processAudio() — иначе задержка не имела бы смысла: аудио приходит каждые
   * ~100мс, и каждый чанк заново запускал бы попытку.
   *
   * Никогда не останавливается сама (см. reconnect-backoff.ts): после
   * RECONNECT_MAX_ATTEMPTS подряд неудач статус становится 'failed', но
   * попытки продолжаются с постоянным (редким) интервалом — длинный обрыв
   * должен самоисцеляться, а не убивать сессию до конца звонка.
   */
  private scheduleReconnect(): void {
    if (this.stopping) {
      // Соединение закрывается нарочно (finalize()/destroy()) — это не сбой.
      return;
    }
    if (this.reconnectTimer !== null) {
      // Реконнект уже запланирован (например, и 'error', и 'close' пришли по
      // одному разрыву) — не плодим параллельные таймеры на одну и ту же попытку.
      return;
    }
    if (!this.deepgramClient || !shouldReconnect(this.connectionState, this.initialized)) {
      return;
    }

    const delayMs = this.reconnectBackoff.recordFailure();
    const status: STTStatus = this.reconnectBackoff.isDegraded() ? 'failed' : 'reconnecting';

    debugReconnect(
      `SCHEDULE_RECONNECT attempt=${this.reconnectBackoff.attempt} delayMs=${delayMs} status=${status}`,
    );
    this.emitStatus(status);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.performReconnect();
    }, delayMs);
  }

  /** Собственно пересоздание соединения — то, что раньше называлось tryReconnect(). */
  private performReconnect(): void {
    // LS-31: реконнект допустим только из состояния 'closed'. Если к моменту
    // срабатывания таймера соединение уже открылось или снова закрывается —
    // это no-op, а не повод создавать лишнее параллельное соединение.
    if (!this.deepgramClient || !shouldReconnect(this.connectionState, this.initialized)) {
      return;
    }

    debugReconnect('RECONNECT');

    // Фиксируем смещение ДО создания нового соединения: новая сессия Deepgram
    // начнёт отсчёт своего startSec с нуля, а смещение компенсирует это на
    // выходе из processResults.
    this.streamClock.markReconnect();

    try {
      this.connection?.finish?.();
    } catch {
      // ignore finish errors
    }

    try {
      this.createConnection();
    } catch {
      // Явно возвращаем 'closed', не полагаясь на то, что createConnection()
      // упал раньше, чем успел выставить 'connecting': если исключение
      // случится ПОСЛЕ этой строки внутри createConnection() (например, при
      // навешивании обработчиков), состояние иначе зависло бы в 'connecting'
      // без сторожевого таймера на этот путь — createConnection() бросает
      // до вызова connectWatchdog.start(). Безусловный сброс здесь дешевле,
      // чем разбираться, где именно упало.
      this.connectionState = 'closed';
      this.scheduleReconnect();
    }
  }

  async processAudio(audioBuffer: Buffer, format?: string): Promise<STTResult | null> {
    if (!this.initialized || !this.connection) {
      throw new Error('Deepgram not initialized. Call initialize() first.');
    }

    this.queueAudioChunk(audioBuffer);

    if (this.connectionState !== 'open') {
      // LS-04: реконнект уже запланирован (или провайдер уже 'failed') через
      // scheduleReconnect(), вызванный из обработчика close/error/watchdog —
      // здесь просто копим аудио в audioBuffer, не трогая таймер повторно.
      // Раньше здесь стоял немедленный tryReconnect() на каждый чанк.
      return null;
    }

    try {
      if (format === 'pcm' || !format) {
        this.flushBufferedAudio();
      } else {
        this.flushBufferedAudio();
      }

      if (this.onResultCallback) {
        return null;
      }

      const latestPartial = this.partialResults[this.partialResults.length - 1] || null;
      const latestFinal = this.finalResults[this.finalResults.length - 1] || null;

      return latestFinal || latestPartial;
    } catch {
      this.connectionState = 'closed';
      this.scheduleReconnect();
      return null;
    }
  }

  async finalize(): Promise<STTResult | null> {
    if (!this.connection) {
      return null;
    }

    // Дальше идёт нарочное закрытие — 'close', который сейчас же придёт от
    // транспорта, не должен планировать реконнект (см. комментарий у поля).
    this.stopping = true;

    try {
      this.connection.finish();

      const latestFinal = this.finalResults[this.finalResults.length - 1] || null;
      const latestPartial = this.partialResults[this.partialResults.length - 1] || null;

      return latestFinal || latestPartial;
    } catch {
      // console.error('Deepgram finalize error:', err);
      return null;
    }
  }

  async destroy(): Promise<void> {
    // destroy() без предшествующего finalize() (например, если initialize()
    // провайдера не удалось довести до конца) — тоже нарочное закрытие. Не
    // сбрасываем этот флаг обратно ниже — инстанс всё равно выбрасывается, а
    // сброс ДО this.connection.finish() ровно воспроизводил бы баг, который
    // stopping должен чинить: если 'close' на закрываемом соединении придёт
    // синхронно (для сокета в CONNECTING это обычное поведение многих
    // реализаций), он пройдёт все проверки и запланирует реконнект у
    // провайдера, который уже в процессе уничтожения.
    this.stopping = true;
    this.connectWatchdog.cancel();

    // LS-04: таймер реконнекта не должен переживать смену/уничтожение
    // соединения — тот же класс ошибок, что уже был пойман со сторожевым
    // таймером на connect (см. connect-watchdog.ts): без явной отмены он
    // выстрелил бы после destroy() и попытался бы создать соединение у
    // уже уничтоженного провайдера.
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.connection) {
      try {
        this.connection.finish();
      } catch {
        // console.error('Error closing Deepgram connection:', err);
      }
      this.connection = null;
    }

    this.reconnectBackoff.reset();
    this.statusCallback = null;
    this.lastEmittedStatus = null;
    this.deepgramClient = null;
    this.onResultCallback = null;
    this.partialResults = [];
    this.finalResults = [];
    this.audioBuffer = [];
    this.connectionState = 'closed';
    this.initialized = false;
    // console.log('Deepgram resources cleaned up');
  }
}

