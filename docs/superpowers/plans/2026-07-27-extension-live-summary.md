# Extension live-summary Implementation Plan (LS-09, sub-project B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** По кнопке в виджете расширения показать 3-6 коротких тезисов текущего живого мита (быстрая модель, эфемерно), переиспользуя LLM-ядро.

**Architecture:** Бэкенд — `POST /api/live-summary` (токен-авторизация, тело `{transcript}`, `LLM_MODEL_LIVE`, без персиста) поверх нового `packages/backend/src/llm/live-summary.ts`. Расширение — кнопка в виджете (`content.ts`) → сообщение в service worker → SW делает cross-origin fetch (host_permissions, без CORS) → рендер тезисов.

**Tech Stack:** Fastify 5 (ESM, `.js`-импорты), Prisma, vitest; MV3 (content script + service worker), Vite `define` (`__API_URL__`). Общие типы — `@livescribe/shared`.

Spec: `docs/superpowers/specs/2026-07-27-extension-live-summary-design.md`.

## Global Constraints

- ESM: относительные импорты в бэке — с `.js`. Общие типы — из `@livescribe/shared`.
- LLM-ключ опционален: нет ключа → эндпоинт `503 analysis_unavailable`, не 500. Коды: `401 unauthorized`, `503 analysis_unavailable`, `400 no_transcript`, `502 analysis_failed`.
- Live-саммари **эфемерно** — ничего не пишем в БД. Модель — `getLiveModel()` (не detailed).
- Кросс-доменный fetch — в service worker, НЕ в content-script (CORS). Manifest не менять.
- Русский UI-текст; английские идентификаторы. Перед коммитом: `npm run type-check` зелёный; для бэк-задачи — `npm run test --workspace=@livescribe/backend` зелёный; для расширения — `npm run build:extension` собирается.
- Читать затрагиваемый файл перед правкой; следовать паттернам (`getSkriboToken()` и `onMessage` в SW; `escapeHtml` и инлайн-стили в `content.ts`).

---

### Task 1: Бэкенд — live-summary модуль + токен-авторизация + эндпоинт

**Files:**
- Create: `packages/backend/src/llm/live-summary.ts`
- Create: `packages/backend/src/llm/live-summary.test.ts`
- Create: `packages/backend/src/api/llm-routes.ts`
- Modify: `packages/backend/src/auth/guard.ts`
- Modify: `packages/backend/src/server.ts`
- Modify: `packages/shared/src/domain.ts`

**Interfaces:**
- Consumes: `chatJson`/`ChatArgs` (openrouter.js), `getLiveModel`/`isLlmConfigured` (config.js), `hashToken` (tokens.js), `prisma`.
- Produces: `summarizeLive(transcript, deps?)`, `coerceBullets(raw)` (live-summary.ts); `resolveUserByToken(raw)` (guard.ts); `registerLlmRoutes(server)` (llm-routes.ts); `LiveSummaryDTO` (shared).

- [ ] **Step 1:** `packages/backend/src/llm/live-summary.ts`:
```ts
import { chatJson, type ChatArgs } from './openrouter.js';
import { getLiveModel } from './config.js';

export function coerceBullets(raw: unknown): string[] {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const arr = Array.isArray(obj.bullets) ? obj.bullets : [];
  return arr
    .filter((b): b is string => typeof b === 'string')
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .slice(0, 6);
}

const SYSTEM = [
  'Ты кратко резюмируешь идущую деловую встречу по её расшифровке.',
  'Верни JSON-объект { "bullets": [строки] } — от 3 до 6 очень коротких тезисов:',
  'о чём говорят и какие договорённости/решения уже прозвучали.',
  'Пиши на языке расшифровки. Каждый тезис — одна короткая фраза.',
].join(' ');

export async function summarizeLive(
  transcript: string,
  deps: { chat?: (args: ChatArgs) => Promise<unknown> } = {}
): Promise<{ bullets: string[] }> {
  const chat = deps.chat ?? chatJson;
  const raw = await chat({
    model: getLiveModel(),
    system: SYSTEM,
    user: `Расшифровка (возможно, неполная — встреча идёт):\n\n${transcript}`,
    maxTokens: 400,
    timeoutMs: 15000,
  });
  return { bullets: coerceBullets(raw) };
}
```

- [ ] **Step 2:** `packages/backend/src/llm/live-summary.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { coerceBullets, summarizeLive } from './live-summary.js';

describe('coerceBullets', () => {
  it('keeps non-empty string bullets, trims, caps at 6', () => {
    const out = coerceBullets({ bullets: ['  Раз  ', '', 'Два', 3, null, 'Три', 'Ч', 'П', 'Ш', 'С'] });
    expect(out).toEqual(['Раз', 'Два', 'Три', 'Ч', 'П', 'Ш']);
  });
  it('returns [] on garbage/missing', () => {
    expect(coerceBullets(null)).toEqual([]);
    expect(coerceBullets({ bullets: 'nope' })).toEqual([]);
  });
});

describe('summarizeLive', () => {
  it('passes transcript to chat and coerces bullets', async () => {
    let seen = '';
    const out = await summarizeLive('Аня: Привет', {
      chat: async (args) => { seen = args.user; return { bullets: ['Пункт'] }; },
    });
    expect(seen).toContain('Аня: Привет');
    expect(out).toEqual({ bullets: ['Пункт'] });
  });
});
```

- [ ] **Step 3:** В `packages/backend/src/auth/guard.ts` добавить импорты и хелпер:
```ts
import { prisma } from '../db/prisma.js';
import { verifyJwt, hashToken } from './tokens.js';
```
(строку `import { verifyJwt } from './tokens.js';` заменить на вариант с `hashToken`.) И функция:
```ts
export async function resolveUserByToken(rawToken: string | undefined | null): Promise<{ id: string } | null> {
  const raw = rawToken?.trim();
  if (!raw) return null;
  const tok = await prisma.personalToken.findFirst({ where: { tokenHash: hashToken(raw) } });
  return tok ? { id: tok.userId } : null;
}
```

- [ ] **Step 4:** `packages/backend/src/api/llm-routes.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { resolveUserByToken } from '../auth/guard.js';
import { isLlmConfigured } from '../llm/config.js';
import { summarizeLive } from '../llm/live-summary.js';

const MAX_TRANSCRIPT = 16000;

export function registerLlmRoutes(server: FastifyInstance) {
  server.post('/api/live-summary', async (req, reply) => {
    const auth = req.headers.authorization;
    const raw = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    const user = await resolveUserByToken(raw);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    if (!isLlmConfigured()) return reply.code(503).send({ error: 'analysis_unavailable' });

    const body = (req.body ?? {}) as { transcript?: unknown };
    const trimmed = typeof body.transcript === 'string' ? body.transcript.trim() : '';
    if (!trimmed) return reply.code(400).send({ error: 'no_transcript' });
    const transcript = trimmed.length > MAX_TRANSCRIPT ? trimmed.slice(-MAX_TRANSCRIPT) : trimmed;

    try {
      const result = await summarizeLive(transcript);
      return { bullets: result.bullets };
    } catch (err) {
      req.log.error({ err }, 'live summary failed');
      return reply.code(502).send({ error: 'analysis_failed' });
    }
  });
}
```

- [ ] **Step 5:** В `packages/backend/src/server.ts` — импорт и регистрация рядом с прочими:
```ts
import { registerLlmRoutes } from './api/llm-routes.js';
```
и после `registerMeetingRoutes(server);`:
```ts
  registerLlmRoutes(server);
```

- [ ] **Step 6:** В `packages/shared/src/domain.ts` добавить:
```ts
export interface LiveSummaryDTO { bullets: string[]; }
```

- [ ] **Step 7: Verify** — `npm run type-check` (корень) зелёный; `npm run test --workspace=@livescribe/backend` — новые тесты (coerceBullets/summarizeLive) проходят, старые не сломаны.

- [ ] **Step 8: Commit**
```bash
git add packages/backend/src/llm/live-summary.ts packages/backend/src/llm/live-summary.test.ts packages/backend/src/api/llm-routes.ts packages/backend/src/auth/guard.ts packages/backend/src/server.ts packages/shared/src/domain.ts
git commit -m "feat(backend): live-summary endpoint (token-auth, fast model, ephemeral)"
```

---

### Task 2: Расширение — кнопка «Саммари» в виджете + fetch в service worker

**Files:**
- Modify: `packages/extension/src/background/service-worker.ts`
- Modify: `packages/extension/src/content/content.ts`

**Interfaces:**
- Consumes: эндпоинт `POST /api/live-summary`, `__API_URL__`, `getSkriboToken()` (SW), `transcriptReplicas`/`partialReplica`/`escapeHtml` (content.ts).
- Produces: SW-обработчик сообщения `LIVE_SUMMARY`; кнопка + панель саммари в виджете.

- [ ] **Step 1:** В `service-worker.ts`, внутри существующего `chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => { … })`, добавить ветку (до финального `return`). `getSkriboToken()` уже определён в этом файле; `__API_URL__` — глобал из Vite define (используется в попапе):
```ts
    if (message.type === 'LIVE_SUMMARY') {
      (async () => {
        const token = await getSkriboToken();
        if (!token) { sendResponse({ error: 'not_authed' }); return; }
        try {
          const res = await fetch(`${__API_URL__}/api/live-summary`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ transcript: typeof message.transcript === 'string' ? message.transcript : '' }),
          });
          if (!res.ok) {
            let code = `http_${res.status}`;
            try { const b = await res.json(); if (b?.error) code = b.error; } catch { /* ignore */ }
            sendResponse({ error: code });
            return;
          }
          const data = (await res.json()) as { bullets?: unknown };
          sendResponse({ bullets: Array.isArray(data?.bullets) ? data.bullets : [] });
        } catch {
          sendResponse({ error: 'network' });
        }
      })();
      return true; // async response
    }
```
Примечание: если листенер уже возвращает значение в конце — не ломать существующую логику; добавить ветку с собственным `return true` внутри неё.

- [ ] **Step 2:** В `content.ts` — сбор транскрипта и обработчик (рядом с триггер-функциями). `transcriptReplicas`/`partialReplica`/`escapeHtml` уже есть:
```ts
function collectTranscriptText(): string {
  const lines = transcriptReplicas.map((r) => `${r.speaker}: ${r.text}`);
  if (partialReplica && partialReplica.text.trim()) {
    lines.push(`${partialReplica.speaker}: ${partialReplica.text.trim()}`);
  }
  return lines.join('\n').trim();
}

function summaryErrorText(code: string): string {
  if (code === 'not_authed') return 'Войдите в расширении, чтобы получить саммари';
  if (code === 'analysis_unavailable' || code === 'http_503') return 'Саммари пока не настроено';
  if (code === 'no_transcript' || code === 'http_400') return 'Нет транскрипта для саммари';
  return 'Не удалось получить саммари. Попробуйте ещё раз';
}

function renderSummary(panel: HTMLElement, bullets: string[]): void {
  if (bullets.length === 0) {
    panel.innerHTML = '<div style="color:#6b7280; font-size:11px;">Пока нечего резюмировать.</div>';
    return;
  }
  panel.innerHTML =
    '<ul style="margin:0; padding-left:16px; line-height:1.5;">' +
    bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('') +
    '</ul>';
}

function requestLiveSummary(): void {
  const panel = document.getElementById('skribo-summary-panel');
  const btn = document.getElementById('skribo-summary-btn') as HTMLButtonElement | null;
  if (!panel) return;
  const transcript = collectTranscriptText();
  panel.style.display = 'block';
  if (!transcript) {
    panel.innerHTML = '<div style="color:#6b7280; font-size:11px;">Нет транскрипта для саммари</div>';
    return;
  }
  panel.innerHTML = '<div style="color:#6b7280; font-size:11px;">Готовим саммари…</div>';
  if (btn) btn.disabled = true;
  chrome.runtime.sendMessage({ type: 'LIVE_SUMMARY', transcript }, (response) => {
    if (btn) { btn.disabled = false; btn.textContent = 'Обновить саммари'; }
    if (chrome.runtime.lastError || !response) { panel.innerHTML = `<div style="color:#b91c1c; font-size:11px;">${escapeHtml(summaryErrorText('network'))}</div>`; return; }
    if (response.error) { panel.innerHTML = `<div style="color:#b91c1c; font-size:11px;">${escapeHtml(summaryErrorText(String(response.error)))}</div>`; return; }
    renderSummary(panel, Array.isArray(response.bullets) ? response.bullets.map(String) : []);
  });
}
```

- [ ] **Step 3:** В разметке виджета (`widget.innerHTML` в `createUIWidget`) — добавить кнопку и панель рядом с транскриптом (напр. сразу над `#livescribe-transcript`):
```html
      <button id="skribo-summary-btn" style="
        width: 100%; padding: 6px 12px; margin-bottom: 8px;
        background: #0d9488; color: #fff; border: none; border-radius: 4px;
        cursor: pointer; font-size: 12px; font-weight: 500;
      ">Саммари встречи</button>
      <div id="skribo-summary-panel" style="
        display: none; margin-bottom: 8px; padding: 8px;
        background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 4px;
        font-size: 12px; color: #134e4a;
      "></div>
```
И в блоке «Add event listeners» (рядом с `livescribe-reset`):
```ts
  document.getElementById('skribo-summary-btn')?.addEventListener('click', requestLiveSummary);
```

- [ ] **Step 4: Verify.** `npm run type-check` (корень) зелёный; `npm run build:extension` собирается (проверить, что `__API_URL__` резолвится и в SW-бандле). Живая проверка (кнопка на реальном звонке → тезисы; кейс «не залогинен») — за пользователем: собрать, выверить логику, явно указать в отчёте, что визуальная/сетевая проверка за пользователем.

- [ ] **Step 5: Commit**
```bash
git add packages/extension/src/background/service-worker.ts packages/extension/src/content/content.ts
git commit -m "feat(extension): live meeting summary button in widget (via service worker)"
```

---

## Self-Review

- **Spec coverage:** live-summary модуль (bullets, fast model, ephemeral) → Task 1 Step 1; токен-авторизация → Task 1 Step 3; эндпоинт (401/503/400/502) → Task 1 Step 4; DTO → Step 6; SW cross-origin fetch → Task 2 Step 1; кнопка+панель+рендер+ошибки → Task 2 Steps 2-3. Тесты → Task 1 Step 2.
- **Placeholder scan:** весь код приведён (модуль, хелпер, эндпоинт, SW-ветка, UI-функции, разметка, стили).
- **Type consistency:** `summarizeLive(transcript, {chat})`/`coerceBullets` — сигнатуры согласованы; эндпоинт возвращает `{bullets}` ↔ SW читает `data.bullets` ↔ content рендерит `response.bullets`. `resolveUserByToken(raw) → {id}|null` — как `requireUser`. `LiveSummaryDTO {bullets: string[]}` — форма ответа эндпоинта. `__API_URL__` — тот же глобал, что в попапе.

## Вне плана (follow-up)
- Rate-limit/учёт стоимости live-запросов; стрим/авто-обновление.
- Прокидывание meetingId в WS-`status` (если live-саммари когда-то привяжут к встрече).
