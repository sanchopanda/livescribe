# Дизайн: рабочий флоу livescribe (задачи / документация / релизы)

Дата: 2026-07-22
Статус: согласован (ожидает вычитки спеки)

## Контекст и цель

У livescribe нет формализованного процесса: нет доски/бэклога, нет `CHANGELOG`,
`docs/` плоский. У соседнего проекта `../expeditor` есть зрелый harness
(`.claude/skills/` + конвенции документации + релизы). Задача — **перенести этот
флоу в livescribe**, адаптировав под здешний стек (Chrome-расширение MV3 +
Vite/React + Fastify/WS backend, npm workspaces).

### Принятые решения (развилки)

1. **Трекинг задач — только локальные файлы** (`docs/backlog.md` + `docs/PROGRESS.md`).
   Без GitHub Issues и без доски Projects. Минимум внешних зависимостей.
2. **Скиллы — оркестратор + тонкие обёртки.** `proceed` дирижирует; `implement-task`/
   `test-task`/`review-task` короткие, со стек-правилами livescribe, и делегируют
   встроенным навыкам (`superpowers:test-driven-development`, `/code-review`,
   `/verify`, `/run`).
3. **Релизы — `CHANGELOG.md` + git-тег `vX.Y.Z` + GitHub Release.** Ноуты
   группируются из conventional-commits.

Из expeditor **не переносим**: `task-board` (нет доски), `deploy` (livescribe —
расширение, серверного деплоя нет), отдельный `dev-troubleshooting` (его правило
«проверь, прежде чем звать смотреть» вшиваем в `test-task`).

## Блок 1. Трекинг задач — локальные файлы

- **`docs/backlog.md`** — приоритизированный список. Формат задачи:
  `- [ ] LS-NN — <заголовок>` + строка намерения; сгруппировано по фазам/этапам.
  Чекбокс закрывается при завершении задачи.
- **`docs/PROGRESS.md`** — курсор состояния. Разделы:
  **Сделано** (последнее), **Следующее** (кандидат), **Задача в работе**
  (id / ветка / PR), **Блокеры**.
- **Источник истины статуса** = эти файлы + git (влитая ветка/PR). На каждой
  **логической точке** (влитый PR, завершённая задача, конец сессии) — прежде чем
  браться за новое — сверять `backlog.md`/`PROGRESS.md` с реальностью git и чинить
  дрейф.
- Идентификатор задачи: префикс `LS-` + число (LS-01, LS-02, …).

## Блок 2. Скиллы (`.claude/skills/`)

Каждый скилл — `SKILL.md` с YAML-фронтматтером (`name`, `description`), по образцу
expeditor, но с правилами livescribe.

- **`proceed`** — оркестратор рабочего цикла, **ровно одна задача за вызов**:
  1. Прочитать `PROGRESS.md`, `backlog.md`, `AGENTS.md`.
  2. Сверка с git-реальностью (влитые PR/ветки) → починить дрейф статусов.
  3. Выбрать задачу: сперва «в работе», иначе верхняя из backlog по приоритету.
  4. Пометить «в работе» в `PROGRESS.md`.
  5. `implement-task` → `test-task` (петля до зелёного) → `review-task`
     (чинить критичное до чистоты).
  6. Коммит(ы) по смыслу, пуш ветки, открыть/обновить PR (`Closes` не нужен — Issues нет).
  7. Отметить задачу done в `backlog.md`, обновить `PROGRESS.md`.
  8. Отчёт владельцу и **стоп** (ждать следующего «продолжай»).
  Триггеры: «продолжай / дальше / поехали / continue», `/proceed`.
  Блокеры: не выдумывать — описать, вернуть статус, обновить `PROGRESS.md`, спросить.

- **`implement-task`** (тонкий):
  - Ветка `feat/<id>-<slug>` (латиница, kebab-case).
  - Стек-правила livescribe: npm workspaces; расширение MV3
    (`content`/`background|service-worker`/`popup`, MAIN-world хуки, `manifest.json`);
    общие типы — `packages/shared`; backend — Fastify + WebSocket; STT — только
    Deepgram; conventional-commits; `npm run type-check` обязан быть зелёным; секреты/
    `.env`/`dist` не коммитить.
  - Логику (кодеки, VAD, расчёты) — через `superpowers:test-driven-development`.
  - После кода обновить документацию: `KNOWLEDGE.md` / спека / ADR при изменении
    правил/архитектуры.
  - **Не** мержит и **не** отмечает done — это делает `proceed`.

- **`test-task`** (тонкий): `npm run type-check` + `npm run build`; для поведения
  расширения/UI — прогон через `/run` или Chrome DevTools MCP с наблюдением результата;
  правило «**проверь, прежде чем звать смотреть**» (не заявлять «работает» без
  реальной проверки); делегирует `/verify`. Вердикт **PASS/FAIL** с доказательствами;
  код здесь не чинит.

- **`review-task`** (тонкий): делегирует `/code-review`, затем короткий чек-лист:
  стек-правила соблюдены, доки обновлены, нет секретов/`dist`/`node_modules` в индексе.
  Находки по severity; критичное чинится (через `implement-task`/`test-task`) до Done.

- **`release`**: единая semver-версия монорепо — источник правды `version` в корневом
  `package.json`. Шаги: определить bump (feat→minor, fix/chore→patch, ломающее→major;
  уточнить у владельца при неоднозначности) → собрать ноуты из коммитов с прошлого тега
  → бампнуть версию → обновить `CHANGELOG.md` (Keep a Changelog, русский, по разделам
  Добавлено/Исправлено/Прочее) → коммит `chore(release): vX.Y.Z` + тег + пуш
  `--follow-tags` → `gh release create vX.Y.Z` с теми же ноутами. Пред-условия: `main`
  чист и запушен, `type-check`+`build` зелёные. Релиз ≠ деплой.

## Блок 3. Конвенции и каркас документации

- **`docs/CONVENTIONS.md`** — именование (kebab-case латиница для файлов/папок; русский
  текст / английские идентификаторы), карта «где что лежит», имена спек
  (`docs/specs/NN-<feature>.md`) и ADR (`docs/decisions/NNNN-<decision>.md`),
  commit-конвенции.
- **`docs/KNOWLEDGE.md`** — тонкий: глоссарий + грабли + указатели на AGENTS.md и
  существующие доки (без дублирования). Не раздувать.
- **`docs/decisions/`** — ADR. Первый: `0001-stt-deepgram-only.md` (уже принятое
  решение оставить только Deepgram).
- **`docs/specs/`** — спеки фич (пусто на старте, `.gitkeep`).
- **`docs/README.md`** — карта документации.
- **`AGENTS.md`** — дописать секцию «Флоу»: дизайн-до-кода; «доки = зеркало реальности»
  (сверка на логической точке); где что лежит; список скиллов и когда их звать.
- Существующие плоские доки (`plan.md`, `plan-improved.md`, `connection-behavior.md`,
  `audio-capture-methods.md`, `permissions-timing.md`, `SPEAKER_DETECTION_ARCHIVE.md`)
  — оставить, сослаться из `README.md`/`KNOWLEDGE.md`. Историю не переписываем.

## Блок 4. Релиз-ноуты

`CHANGELOG.md` (Keep a Changelog) + тег `vX.Y.Z` + GitHub Release, всё через скилл
`release`. Репо на `0.1.0`; первый прогон — baseline текущего состояния
(включая только что влитые Meet per-track и Deepgram-only).

## Дефолты по открытым моментам

- **(а)** `backlog.md` сидлю реальными задачами из текущего состояния (напр.: Zoom/Teams
  per-track, авто-детект платформы, обработка ошибок Deepgram, упаковка расширения).
  Отдельный `ROADMAP.md` пока не заводим — фазы держим секциями в `backlog.md`.
- **(б)** `KNOWLEDGE.md` делаем тонким (указатели + грабли), т.к. `AGENTS.md` уже несёт
  обзор домена.

## Границы (YAGNI)

- Без GitHub Issues/Projects, без `task-board`.
- Без серверного `deploy`.
- Без переписывания исторических планов в `docs/`.
- Скиллы implement/test/review — тонкие обёртки, не дублируют встроенные навыки.

## Критерии готовности

- `.claude/skills/{proceed,implement-task,test-task,review-task,release}/SKILL.md` созданы.
- `docs/{backlog,PROGRESS,CONVENTIONS,KNOWLEDGE,README}.md`, `docs/decisions/0001-*.md`,
  `docs/specs/.gitkeep` созданы и связаны.
- `CHANGELOG.md` создан (заголовок + baseline-секция).
- `AGENTS.md` расширен секцией «Флоу».
- Прогон `proceed` на первой задаче из `backlog.md` проходит цикл без ручных костылей.
