# Extension trigger-word highlight Implementation Plan (LS-14)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Пользователь задаёт триггер-слова в виджете расширения; когда финальная реплика транскрипта содержит триггер — реплика подсвечивается и виджет коротко пульсирует.

**Architecture:** Всё в `packages/extension/src/content/content.ts` (встроенный виджет) + его инлайн-стили. Триггеры в `chrome.storage.local` (`skriboTriggers: string[]`, permission `"storage"` уже есть). Без бэкенда/LLM; WS/offscreen/service-worker/audio не трогаем.

**Tech Stack:** TS, MV3 content script, `chrome.storage.local`. Spec: `docs/superpowers/specs/2026-07-27-extension-trigger-highlight-design.md`.

## Global Constraints

- Матч по **финальным** репликам (не partial), **регистронезависимо, по границе слова** (Unicode-aware для кириллицы).
- Триггеры: тримятся, пустые игнорируются, дедуп case-insensitive; хранятся в `chrome.storage.local.skriboTriggers`.
- Без desktop-нотификаций (только визуально). Без регэкспов от пользователя (простые слова/фразы; экранировать при построении RegExp).
- Русский UI-текст; английские идентификаторы. `npm run type-check` + `npm run build:extension` зелёные перед коммитом.
- Читать релевантные участки `content.ts` (createUIWidget, appendTranscriptReplica, updateTranscript/render, escapeHtml) перед правками; минимальные аккуратные изменения в большом файле.
- **Идиома файла:** виджет использует ТОЛЬКО инлайн-стили (нет `<style>`-элемента; транскрипт рендерится через `innerHTML` с инлайн-стилями по строке). НЕ инжектить `<style>`/`@keyframes` в страницу. Подсветку реплики делать инлайн-стилями в `updateTranscript`; вспышку виджета — через Web Animations API (`widget.animate(...)`), без CSS-классов и без затирания базового `box-shadow`.

---

### Task 1: Хранилище триггеров + секция конфигурации в виджете

**Files:** Modify `packages/extension/src/content/content.ts`

**Interfaces:**
- Produces: модуль-состояние `triggers: string[]`; загрузка из `chrome.storage.local` при инициализации; функции `addTrigger(word)`, `removeTrigger(word)` (сохраняют в storage + перерисовывают список); секция «Триггеры» в виджете (инпут + список с удалением).

- [ ] **Step 1:** Добавить состояние и загрузку. Рядом с другим состоянием виджета:
```ts
let triggers: string[] = [];
function normalizeTrigger(w: string): string { return w.trim(); }
async function loadTriggers(): Promise<void> {
  try {
    const { skriboTriggers } = await chrome.storage.local.get('skriboTriggers');
    triggers = Array.isArray(skriboTriggers) ? skriboTriggers.filter((t) => typeof t === 'string') : [];
  } catch { triggers = []; }
}
async function saveTriggers(): Promise<void> {
  try { await chrome.storage.local.set({ skriboTriggers: triggers }); } catch { /* ignore */ }
}
```
Вызвать `void loadTriggers().then(renderTriggers)` при инициализации виджета (там же, где создаётся виджет).

- [ ] **Step 2:** `addTrigger`/`removeTrigger` + рендер списка:
```ts
function addTrigger(raw: string): void {
  const w = normalizeTrigger(raw);
  if (!w) return;
  if (triggers.some((t) => t.toLowerCase() === w.toLowerCase())) return;
  triggers.push(w);
  void saveTriggers();
  renderTriggers();
}
function removeTrigger(w: string): void {
  triggers = triggers.filter((t) => t !== w);
  void saveTriggers();
  renderTriggers();
}
```
`renderTriggers()` — перерисовывает список чипов с крестиком в контейнере `#skribo-triggers-list` (использовать `escapeHtml` для текста; навесить обработчики удаления).

- [ ] **Step 3:** Разметка секции в `createUIWidget` внутри `widget.innerHTML` — блок **сразу над** `#livescribe-transcript` (после `#livescribe-reset`/метрик, перед `#livescribe-ws-recovery`), инлайн-стили в духе виджета (напр. `<div style="margin-bottom: 8px;">`): заголовок «Триггеры», строка (`display:flex; gap:4px`) с `<input id="skribo-trigger-input" placeholder="Добавить слово…" style="flex:1; padding:6px 8px; border:1px solid #d1d5db; border-radius:4px; font-size:12px;">` + `<button id="skribo-trigger-add" ...>+</button>`, и `<div id="skribo-triggers-list" style="display:flex; flex-wrap:wrap; gap:4px; margin-top:6px;"></div>`. Обработчики повесить в блоке «Add event listeners» (рядом с `livescribe-reset`): клик по `#skribo-trigger-add` и Enter в `#skribo-trigger-input` → `addTrigger(input.value); input.value=''`. `renderTriggers()` рисует чипы: каждый — `<span>` со словом (через `escapeHtml`) + крестик; удаление — через `querySelectorAll` + `addEventListener` после рендера, НЕ инлайн-`onclick`.

- [ ] **Step 4: Verify** — `npm run type-check` зелёный; `npm run build:extension` собирается.

- [ ] **Step 5: Commit**
```bash
git add packages/extension/src/content/content.ts
git commit -m "feat(extension): trigger words config in widget (chrome.storage.local)"
```

### Task 2: Детект триггера в транскрипте + подсветка + браузер-проверка

**Files:** Modify `packages/extension/src/content/content.ts`

**Interfaces:**
- Consumes: `triggers` (Task 1), точку добавления финальной реплики, рендер транскрипта.
- Produces: подсветка реплики с триггером + короткая вспышка виджета.

- [ ] **Step 1:** Матчер (Unicode word-boundary, экранирование):
```ts
function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function matchesTrigger(text: string): boolean {
  if (!triggers.length) return false;
  return triggers.some((t) => {
    const w = t.trim();
    if (!w) return false;
    try { return new RegExp('(^|\\P{L})' + escapeRegExp(w) + '($|\\P{L})', 'iu').test(text); }
    catch { return text.toLowerCase().includes(w.toLowerCase()); }
  });
}
```

- [ ] **Step 2:** Расширить тип: `interface TranscriptReplica { speaker: string; text: string; highlighted?: boolean; }`. Детект делать **внутри `appendTranscriptReplica`** (это единственный путь финальных реплик — partial только присваивает `partialReplica`, `append` не вызывает, так что partial автоматически не триггерит). После того как определён целевой объект реплики (ветка merge — `lastReplica`; ветка push — только что добавленный элемент): если `matchesTrigger(trimmedText)` → выставить `target.highlighted = true` и вызвать `flashWidget()`. В merge-ветке highlighted не сбрасывать (`||=`-семантика: если уже true — остаётся). Ветки early-return (дубликаты, пустой текст) не трогать.

- [ ] **Step 3:** Рендер в `updateTranscript`: для реплики с `replica.highlighted === true` добавить к её `<div>` инлайн-стили `border-left: 3px solid #0d9488; background: rgba(13,148,136,0.08); padding-left: 6px;` (объединить со стилями существующей ветки showSpeakerLabel / не-label; можно вынести общий `highlightStyle` и подставлять в оба варианта). `flashWidget()` через Web Animations API (без `<style>`/классов, не затирает базовый `box-shadow`):
```ts
function flashWidget(): void {
  const w = document.getElementById('livescribe-widget');
  if (!w || typeof w.animate !== 'function') return;
  w.animate(
    [
      { boxShadow: '0 0 0 0 rgba(13,148,136,0)' },
      { boxShadow: '0 0 0 4px rgba(13,148,136,0.6)', offset: 0.3 },
      { boxShadow: '0 0 0 0 rgba(13,148,136,0)' },
    ],
    { duration: 1000, easing: 'ease' }
  );
}
```

- [ ] **Step 4: Verify (браузер).** `npm run type-check` + `npm run build:extension` зелёные. Загрузить `dist` в Chrome (или прогнать через Chrome DevTools MCP на тест-странице, где можно вручную дёрнуть `appendTranscriptReplica`/эмулировать финальную реплику): добавить триггер «тест» в виджете → подать реплику с «тест» → реплика подсвечена + виджет пульснул; реплика без триггера → без подсветки; частичная (partial) реплика с триггером → НЕ триггерит; триггер сохраняется после перезагрузки виджета. Если полноценный браузер-прогон недоступен — собрать, проверить логику чтением и явно указать, что визуальная проверка за пользователем.

- [ ] **Step 5: Commit**
```bash
git add packages/extension/src/content/content.ts
git commit -m "feat(extension): highlight transcript replica + flash widget on trigger word"
```

---

## Self-Review

- **Spec coverage:** конфиг триггеров в виджете + storage → Task 1; детект (final, word-boundary, case-insensitive) + подсветка реплики + вспышка виджета → Task 2; без нотификаций/partial/LLM → Global Constraints. Проверка → Task 2 Step 5.
- **Placeholder scan:** ключевой код (загрузка/сохранение, матчер, flash, стили) приведён; разметка секции задана поведением (встраивается в существующий `createUIWidget`).
- **Type consistency:** `triggers: string[]`, `skriboTriggers` ключ storage, `matchesTrigger`/`flashWidget`/`addTrigger`/`removeTrigger`, флаг реплики `highlighted?` — согласованы между задачами.

## Вне плана (follow-up)
- Опц.: desktop-нотификация при триггере (chrome.notifications).
- Опц.: предзаполнить триггеры именем аккаунта.
- Быстрое саммари — отдельная фича (LLM/LS-09).
