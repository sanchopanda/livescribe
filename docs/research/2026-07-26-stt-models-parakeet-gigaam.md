# Ресёрч: STT-модели для self-hosting — NVIDIA Parakeet и GigaAM (Sber)

Дата: 2026-07-26
Цель: оценить открытые ASR-модели (RU-оптимизированные) как замену/дополнение Deepgram
для живой транскрипции звонков (RU + EN, стриминг по WebSocket). Решение — в
`docs/decisions/0005-stt-strategy-self-hosted-ru.md`.

## Главная развилка: облако vs self-host

- **Deepgram (сейчас):** облачный API, STT вынесен → бэкенд на дешёвом CPU-VPS. Поминутная
  оплата. Данные уходят к Deepgram.
- **GigaAM / Parakeet:** открытые модели с HuggingFace → хостить на **своём GPU**. Дороже +
  ops, но без API-платы, данные on-prem (152-ФЗ), офлайн, потенциально лучше русский.

## GigaAM (Sber)

- **GigaAM-v3** (ноя 2025): RU-специализация, обучен на 700k часов, встроены
  пунктуация/нормализация, по заявлению **обходит Whisper на русском**. **Лицензия MIT**
  (полностью коммерческая). CTC + RNN-T + e2e; экспорт в ONNX, деплой через Triton. Есть
  готовый локальный сервер `gigastt`.
  - Минусы: заточен под RU (EN/смешанное слабее); real-time стриминг менее обкатан. GPU.
- **GigaAM-Multilingual**: энкодеры 220M/600M, 2M часов, **70+ языков**, лучший WER на
  RU/казахском/киргизском/узбекском, английский «средне». Char-level CTC. **Стриминг
  partial-транскриптов по WebSocket** заявлен. MIT. GPU.

## NVIDIA Parakeet / Nemotron

- **parakeet-tdt-0.6b-v3**: 25 европейских языков вкл. русский, **CC-BY-4.0**. Высокая
  точность, но **офлайн/батч**-ориентирован.
- **Nemotron 3.5 ASR Streaming 0.6B** (июн 2026): **built-for-streaming** (cache-aware
  FastConformer + RNN-T), **40 локалей вкл. RU/EN**, пунктуация, авто-детект языка,
  **ONNX int4** (эффективно). Самый релевантный под живые звонки.
- **parakeet-1.1b-rnnt-multilingual**: 25 языков, лицензия **NVIDIA Community** (ограничительнее).
- Требуют NVIDIA GPU (NeMo / Riva / NIM / ONNX / TRT).

## Сравнение под Skribo

| | Deepgram (сейчас) | GigaAM-v3 | Parakeet Nemotron-Streaming |
|---|---|---|---|
| Русский | ок (nova-3) | **лучший** | приличный |
| Английский/смешанное | хороший | слабее | **хороший** |
| Real-time стриминг | ✅ зрелый | ⚠️ менее проверен | ✅ built-for-streaming |
| Инфра | облако, CPU-VPS хватает | свой GPU | свой GPU |
| Стоимость | поминутно | GPU + ops (без API-платы) | то же |
| Приватность / 152-ФЗ | у Deepgram | on-prem ✅ | on-prem ✅ |
| Лицензия | коммерч. API | **MIT** ✅ | CC-BY-4.0 / Community |

## Вывод

- Сейчас — Deepgram (нулевая инфра). При приоритете качества русского / приватности / объёма
  → self-host **GigaAM-v3** (лучший RU, MIT), либо **Parakeet Nemotron-Streaming** (стриминг + EN).
- Добавляется как провайдер к существующему `STTProvider` (GPU-микросервис). Перед коммитом —
  замерить латентность стриминга на реальных звонках (риск у GigaAM).

## Открытые вопросы для этапа реализации (LS-13)

- Точные WER-числа head-to-head (GigaAM-v3 vs Deepgram nova-3) на нашем аудио (RU + смешанное).
- Зрелость стриминга GigaAM: partial-латентность, стабильность на длинных сессиях.
- GPU-сайзинг: минимальная карта под 0.6B/220–600M модели в fp16/int4; cloud-GPU vs GPU-VPS;
  сколько параллельных сессий на карту.
- Обёртка стриминга: VAD, чанкинг, per-track (наш per-track режим).

## Источники

- nvidia/parakeet-tdt-0.6b-v3, nvidia/nemotron-speech-streaming, onnx-community/nemotron-3.5-asr-streaming (HuggingFace)
- ai-sage/GigaAM-v3, salute-developers/GigaAM (GitHub), ekhodzitsky/gigastt
- Sber open-source ASR release (пресса, ноя 2025)

Проверка проведена (2026-08-06 — 2026-08-07): смок Nemotron/Whisper (Together AI) против
nova-3 на реальных звонках — результаты в
`docs/research/2026-08-06-cloud-stt-smoke-results.md`.
