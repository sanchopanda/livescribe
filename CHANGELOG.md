# Changelog

Все заметные изменения проекта. Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [SemVer](https://semver.org/lang/ru/). Единая версия монорепо живёт в корневом
`package.json`. Релиз выпускается скиллом `release`.

## [Unreleased]

### Добавлено
- Google Meet: покомпонентный (per-track) WebRTC-захват аудио участников.
- Рабочий флоу разработки: скиллы `proceed`/`implement-task`/`test-task`/`review-task`/`release`,
  конвенции документации (`docs/CONVENTIONS.md`), бэклог и курсор (`docs/backlog.md`,
  `docs/PROGRESS.md`), живые заметки (`docs/KNOWLEDGE.md`).

### Изменено
- STT сведён к единственному провайдеру Deepgram (по умолчанию модель `nova-3`).

### Удалено
- Локальные STT-пути: Python-микросервис `packages/stt-service` (Vosk/Whisper) и
  backend-провайдеры Vosk/Vosk-HTTP/Whisper-HTTP; устаревший обзор `STT_ALTERNATIVES.md`.
