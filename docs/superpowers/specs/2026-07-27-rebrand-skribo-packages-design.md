# Дизайн: ребренд идентификаторов пакетов `@livescribe/*` → `@skribo/*` (LS-10)

Дата: 2026-07-27
Статус: согласован

## Контекст и цель

Продукт переименован в Skribo (ADR-0004), но npm-идентификаторы пакетов монорепы всё ещё
`@livescribe/*`. LS-10 — механический атомарный проход: переименовать идентификаторы пакетов и
связанные ссылки в `@skribo/*`, не трогая рантайм-состояние и протоколы.

## В объёме

1. **Имена пакетов** (`package.json`): `@livescribe/{shared,admin,extension,backend}` → `@skribo/…`;
   корневой `livescribe` → `skribo`.
2. **Импорты**: 11 вхождений `from '@livescribe/shared'` → `from '@skribo/shared'` (в `packages/{admin,extension,backend}/src`).
3. **Алиасы сборки**: `packages/extension/tsconfig.json` (`paths`), `packages/extension/vite.config.ts`
   (resolve alias), `packages/admin/vite.config.ts` (`optimizeDeps.include`).
4. **`package-lock.json`** — перегенерировать `npm install` (не править руками).
5. **Живые доки с исполняемыми/актуальными ссылками**: `.claude/skills/deploy/SKILL.md`
   (команды `--workspace=@livescribe/…`), `AGENTS.md`, `README.md`, `docs/backlog.md`.

## Вне объёма (осознанно, follow-up)

- **Рантайм-идентификаторы**: DOM-id виджета (`livescribe-widget`, `livescribe-transcript`, …),
  ключи `localStorage` (`livescribe-widget-position/size/minimized`, `livescribe-language`,
  `livescribe-audio-mode`), лог-префиксы `[LiveScribe]`, MAIN-world-маркеры (`livescribe-source`,
  `livescribe-webrtc-track-*`, `livescribePachcaWebRTCTracksMainInstalled`). Их ренейм сбрасывает
  сохранённое состояние виджета и рискует рассинхроном content ↔ inject — отдельная аккуратная задача.
- **Переименование git-репозитория** и локальной папки — ручная GitHub-операция; git remote
  продолжит работать. Вне кода.
- **Исторические снапшоты** `docs/superpowers/plans/2026-07-*` и ADR — не переписываем.

## Подход

Один атомарный проход (полу-ренейм ломает сборку). Проверка — сборка: `npm install` →
`npm run type-check` → `npm run build` (все воркспейсы) зелёные = ни одна ссылка не пропущена.

## Критерии готовности

- Ни одного `@livescribe` в `packages/**` (код + `package.json` + tsconfig/vite), в
  `.claude/skills/deploy/SKILL.md`, `AGENTS.md`, `README.md`, `docs/backlog.md`.
- `npm run type-check` + `npm run build` (shared/backend/admin/extension) зелёные; бэк-тесты зелёные.
- Рантайм-идентификаторы (DOM/storage/логи/MAIN-world) НЕ изменены.
