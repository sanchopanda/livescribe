# stt-smoke

Одноразовый смок-скрипт для сравнения облачных STT на нашем аудио (PCM s16le, 16 кГц, 1 канал).
Контекст и мотивация — в спеке `docs/superpowers/specs/2026-08-06-cloud-stt-smoke-design.md`:
проверяем, отдают ли Nemotron 3.5 (Together AI) и SaluteSpeech (GigaAM) внятный русский в
стриминге, с эталоном — существующим прод-провайдером Deepgram nova-3.

## Env-переменные

Читаются из `packages/backend/.env` (скрипт грузит его сам через `dotenv`):

- `DEEPGRAM_API_KEY` — для провайдера `deepgram`.
- `TOGETHER_API_KEY` — для провайдера `nemotron` (Together AI).
- `SALUTE_CLIENT_ID`, `SALUTE_CLIENT_SECRET` — для провайдера `salute` (SaluteSpeech, OAuth).

## Команды

```bash
cd packages/backend

# Эталон — Deepgram nova-3 (уже работает)
npm run stt:smoke -- --file recordings/<name>.wav --provider deepgram --seconds 30

# Nemotron 3.5 ASR Streaming (Together AI) — появится в Задаче 3
npm run stt:smoke -- --file recordings/<name>.wav --provider nemotron --seconds 30

# SaluteSpeech (GigaAM) — появится в Задаче 3
npm run stt:smoke -- --file recordings/<name>.wav --provider salute --seconds 30
```

Флаги: `--language ru` (по умолчанию `ru`), `--seconds N` (обрезать запись, чтобы не гонять
целиковый звонок и не тратить лишние деньги), `--out <dir>` (по умолчанию `scripts/stt-smoke/out`),
`--raw` (сохранить сырые сообщения провайдера — для будущих провайдеров nemotron/salute).

Результат — пара файлов в `out/`: `<recording>-<provider>.jsonl` (построчные события
`{ msFromStart, isFinal, text, audioPosSec?, durationSec? }`) и `<recording>-<provider>.txt`
(склеенный финальный текст, для чтения глазами).

**`out/` не коммитить — там транскрипты реальных звонков.** Каталог уже в `.gitignore`.

## Findings

<!-- Сюда — результаты прогонов по каждому провайдеру: латентность, качество, обрывы. -->
