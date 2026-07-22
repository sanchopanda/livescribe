# Карта документации livescribe

Правила ведения документов — в [`CONVENTIONS.md`](CONVENTIONS.md).

## Процесс

- [`backlog.md`](backlog.md) — список задач (`LS-NN`) по фазам.
- [`PROGRESS.md`](PROGRESS.md) — курсор: сделано / следующее / в работе / блокеры.
- [`KNOWLEDGE.md`](KNOWLEDGE.md) — живые заметки: архитектура, глоссарий, грабли.
- [`CONVENTIONS.md`](CONVENTIONS.md) — правила именования и структуры.
- [`../CHANGELOG.md`](../CHANGELOG.md) — релиз-ноуты.
- [`../AGENTS.md`](../AGENTS.md) — канонические правила для AI-агентов (включая флоу).

## Решения и спеки

- [`decisions/`](decisions/) — ADR (`NNNN-<decision>.md`).
  - [`0001-stt-deepgram-only.md`](decisions/0001-stt-deepgram-only.md)
  - `0002` — зарезервирован под хостинг бэкенда (LS-06).
  - [`0003-monorepo-layout-single-port.md`](decisions/0003-monorepo-layout-single-port.md)
- [`specs/`](specs/) — спеки фич (`NN-<feature>.md`).
- [`superpowers/specs/`](superpowers/specs/), [`superpowers/plans/`](superpowers/plans/) —
  дизайн-спеки и планы реализации (навыки brainstorming / writing-plans).

## Существующие заметки (историческое / справочное)

- [`plan.md`](plan.md), [`plan-improved.md`](plan-improved.md) — исходные проектные планы.
- [`audio-capture-methods.md`](audio-capture-methods.md) — методы захвата аудио.
- [`connection-behavior.md`](connection-behavior.md) — поведение WebSocket-соединения.
- [`permissions-timing.md`](permissions-timing.md) — тайминг разрешений расширения.
- [`SPEAKER_DETECTION_ARCHIVE.md`](SPEAKER_DETECTION_ARCHIVE.md) — архив WebRTC/диаризации.
