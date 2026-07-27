# Rebrand package identifiers @livescribe/* → @skribo/* Implementation Plan (LS-10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Single atomic task (a partial rename breaks the build). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Механически переименовать npm-идентификаторы пакетов монорепы `@livescribe/*` → `@skribo/*` (+ корень, импорты, алиасы сборки, живые доки), не трогая рантайм-состояние/протоколы.

**Architecture:** Атомарный проход по всем ссылкам, затем `npm install` (перегенерировать lock + workspace-симлинки) и полная сборка как доказательство.

**Tech Stack:** npm workspaces, TypeScript, Vite. Spec: `docs/superpowers/specs/2026-07-27-rebrand-skribo-packages-design.md`.

## Global Constraints

- Переименовать ТОЛЬКО идентификаторы пакетов и их ссылки. НЕ трогать рантайм-идентификаторы:
  DOM-id `livescribe-*`, ключи `localStorage` `livescribe-*`, лог-префиксы `[LiveScribe]`,
  MAIN-world-маркеры (`livescribe-source`, `livescribe-webrtc-track-*`,
  `livescribePachcaWebRTCTracksMainInstalled`). Их не менять.
- НЕ переписывать исторические снапшоты: `docs/superpowers/plans/**`, `docs/decisions/**`.
- Проверка — сборка, не ручной осмотр.

---

### Task 1: Атомарный ребренд идентификаторов пакетов

**Files:**
- Modify: `package.json` (root `name`)
- Modify: `packages/shared/package.json`, `packages/admin/package.json`, `packages/extension/package.json`, `packages/backend/package.json` (`name` + любые `@livescribe/*` в `dependencies`)
- Modify: все `*.ts`/`*.tsx` под `packages/{admin,extension,backend}/src` с `from '@livescribe/shared'`
- Modify: `packages/extension/tsconfig.json`, `packages/extension/vite.config.ts`, `packages/admin/vite.config.ts`
- Modify (живые доки): `.claude/skills/deploy/SKILL.md`, `AGENTS.md`, `README.md`, `docs/backlog.md`
- Regenerate: `package-lock.json` (через `npm install`)

**Interfaces:**
- Маппинг: `@livescribe/shared→@skribo/shared`, `@livescribe/admin→@skribo/admin`, `@livescribe/extension→@skribo/extension`, `@livescribe/backend→@skribo/backend`, корневой `"name": "livescribe"→"skribo"`.

- [ ] **Step 1: Инвентаризация.** Перечислить все вхождения (для контроля охвата):
```bash
grep -rn "@livescribe" --include='*.ts' --include='*.tsx' --include='*.json' packages package.json | grep -vE 'node_modules|/dist/|package-lock'
```

- [ ] **Step 2: Переименовать имена пакетов.** В `package.json` (root: `"name": "livescribe"` → `"skribo"`) и в каждом `packages/*/package.json` (`"name": "@livescribe/X"` → `"@skribo/X"`). Если в чьих-то `dependencies` есть `@livescribe/shared` — переименовать и там (проверить `grep '@livescribe' packages/*/package.json`).

- [ ] **Step 3: Переименовать импорты и алиасы.** Заменить `@livescribe/shared` → `@skribo/shared` во всех `packages/{admin,extension,backend}/src/**` (`from '@livescribe/shared'`), в `packages/extension/tsconfig.json` (`"paths": { "@livescribe/shared": ... }`), `packages/extension/vite.config.ts` (`'@livescribe/shared': path.resolve(...)`), `packages/admin/vite.config.ts` (`optimizeDeps.include: ['@livescribe/shared']`). Проверить: `grep -rn "@livescribe" packages | grep -vE 'node_modules|/dist/|package-lock'` → пусто.

- [ ] **Step 4: Живые доки.** Заменить `@livescribe/…` → `@skribo/…` в `.claude/skills/deploy/SKILL.md` (команды `--workspace=@livescribe/{shared,backend,admin}`), `AGENTS.md`, `README.md`, `docs/backlog.md`. НЕ трогать `docs/superpowers/plans/**` и `docs/decisions/**`.

- [ ] **Step 5: Перегенерировать lockfile + симлинки.** `npm install --no-audit --no-fund` (это обновит `package-lock.json` под новые имена и переустановит workspace-симлинки `node_modules/@skribo/*`). Если локальный реестр (Verdaccio из `~/.npmrc`) мешает — добавить `--registry=https://registry.npmjs.org/` (НЕ создавать/править `~/.npmrc`).

- [ ] **Step 6: Verify (сборка = доказательство).**
```bash
npm run type-check            # все воркспейсы зелёные
npm run build                 # shared → backend → admin → extension собираются
npm run test --workspace=@skribo/backend   # бэк-тесты зелёные (новое имя воркспейса!)
```
Ожидание: всё зелёное; `grep -rn "@livescribe" packages package.json .claude/skills/deploy AGENTS.md README.md docs/backlog.md | grep -vE 'node_modules|/dist/|package-lock'` → пусто. (В `package-lock.json` могут остаться tarball-URL с прежними именами транзитивных зависимостей — это не наши пакеты, игнорировать; наши workspace-записи должны стать `@skribo/*`.)

- [ ] **Step 7: Verify рантайм НЕ тронут.** Убедиться, что DOM-id/`localStorage`/лог-префиксы не изменены:
```bash
grep -rn "livescribe-widget\|livescribe-transcript\|\[LiveScribe\]\|livescribe-source" packages/extension/src | wc -l
```
Ожидание: число НЕ уменьшилось (рантайм-идентификаторы на месте).

- [ ] **Step 8: Commit**
```bash
git add -A
git commit -m "refactor(LS-10): rebrand package identifiers @livescribe/* -> @skribo/*"
```

---

## Self-Review

- **Spec coverage:** имена пакетов (Step 2), импорты+алиасы (Step 3), живые доки (Step 4), lockfile (Step 5), проверка сборкой (Step 6), рантайм не тронут (Step 7). Вне объёма (рантайм/repo/история) — в Global Constraints.
- **Placeholder scan:** маппинг явный; проверки — командами.
- **Type consistency:** единый маппинг `@livescribe/*`→`@skribo/*`; воркспейс бэка в тест-команде переименован (`@skribo/backend`).

## Вне плана (follow-up)
- Рантайм-ребренд: DOM-id/`localStorage`-ключи/лог-префиксы/MAIN-world-маркеры (со сбросом
  сохранённого состояния виджета — аккуратно, отдельной задачей).
- Переименование git-репозитория `livescribe`→`skribo` на GitHub.
