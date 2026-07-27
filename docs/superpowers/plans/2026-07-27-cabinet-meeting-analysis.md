# Cabinet meeting analysis + LLM core Implementation Plan (LS-09, sub-project A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** По кнопке в карточке встречи кабинета генерировать детальный анализ (саммари + action items) завершённой встречи через LLM (OpenRouter), сохранять в `Analysis`, показывать в кабинете.

**Architecture:** Общее LLM-ядро `packages/backend/src/llm/` (config + OpenRouter-клиент + сборка транскрипта + analysis-профиль), синхронный эндпоинт `POST /api/meetings/:id/analysis`, отображение в `MeetingDetailPage`. Схему БД не меняем (`Analysis.summary`, `Analysis.actionItems Json?` уже есть). Ядро строится так, чтобы под-проект B (live-саммари в расширении) переиспользовал `openrouter.ts`/`config.ts`.

**Tech Stack:** Fastify 5 (ESM, `.js`-суффиксы в импортах), Prisma, TypeScript, global `fetch` (Node 20), vitest (бэк); admin — React 19 + `*.module.scss`, акцент `#0d9488`. Общие типы — `@livescribe/shared` (`packages/shared/src/domain.ts`).

Spec: `docs/superpowers/specs/2026-07-27-cabinet-meeting-analysis-design.md`.

## Global Constraints

- ESM: относительные импорты в бэке — с суффиксом `.js` (напр. `./config.js`). Общие типы — из `@livescribe/shared`.
- LLM-ключ **опциональный** (фича gated): НЕ добавлять `OPENROUTER_API_KEY` в prod-assertion в `index.ts`. Без ключа эндпоинт отвечает `503`, сервер не падает.
- Коды ошибок эндпоинта: `503 analysis_unavailable`, `404 not_found`, `400 no_transcript`, `502 analysis_failed`. Никогда не 500 на этих путях.
- Транскрипт для анализа — только финальные сегменты (`isFinal: true`), в порядке `tsMs`.
- Русский UI-текст; английские идентификаторы. Акцент кабинета — `#0d9488`.
- Перед коммитом задачи: `npm run type-check` (корень) зелёный; для задач с тестами — `npm run test --workspace=@livescribe/backend` зелёный.
- Читать затрагиваемый файл целиком перед правкой; следовать существующим паттернам (`req<T>` в admin `api.ts` шлёт `content-type` только при наличии body — POST без тела не должен требовать JSON-body на бэке).

---

### Task 1: LLM-ядро — config + OpenRouter-клиент + сборка транскрипта (с юнит-тестами)

**Files:**
- Create: `packages/backend/src/llm/config.ts`
- Create: `packages/backend/src/llm/openrouter.ts`
- Create: `packages/backend/src/llm/transcript.ts`
- Create: `packages/backend/src/llm/transcript.test.ts`
- Create: `packages/backend/src/llm/openrouter.test.ts`
- Modify: `packages/backend/.env.example` (добавить LLM-переменные)

**Interfaces:**
- Produces: `isLlmConfigured()`, `getOpenRouterKey()`, `getBaseUrl()`, `getDetailedModel()`, `getLiveModel()` (config.ts); `chatJson(args)`, `parseJsonContent(content)`, класс `LlmError` (openrouter.ts); `buildTranscriptText(segments)`, тип `TranscriptSeg` (transcript.ts).

- [ ] **Step 1:** `config.ts`:
```ts
const DEFAULT_BASE = 'https://openrouter.ai/api/v1';
export function getOpenRouterKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || undefined;
}
export function isLlmConfigured(): boolean {
  return Boolean(getOpenRouterKey());
}
export function getBaseUrl(): string {
  return process.env.OPENROUTER_BASE_URL || DEFAULT_BASE;
}
export function getDetailedModel(): string {
  return process.env.LLM_MODEL_DETAILED || 'anthropic/claude-sonnet-4.5';
}
export function getLiveModel(): string {
  return process.env.LLM_MODEL_LIVE || 'anthropic/claude-haiku-4.5';
}
```

- [ ] **Step 2:** `openrouter.ts`:
```ts
import { getOpenRouterKey, getBaseUrl } from './config.js';

export class LlmError extends Error {}

export function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

export interface ChatArgs {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function chatJson(args: ChatArgs): Promise<unknown> {
  const key = getOpenRouterKey();
  if (!key) throw new LlmError('llm_not_configured');
  const { model, system, user, maxTokens = 1024, timeoutMs = 30000 } = args;

  const doCall = async (extraSystem?: string): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${getBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: extraSystem ? `${system}\n\n${extraSystem}` : system },
            { role: 'user', content: user },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new LlmError(`openrouter_http_${res.status}`);
      const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new LlmError('openrouter_no_content');
      return parseJsonContent(content);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await doCall();
  } catch (err) {
    if (err instanceof SyntaxError) {
      return await doCall('Ответь СТРОГО валидным JSON-объектом без markdown-обёрток.');
    }
    if (err instanceof LlmError) throw err;
    throw new LlmError((err as Error).message || 'openrouter_failed');
  }
}
```

- [ ] **Step 3:** `transcript.ts`:
```ts
export interface TranscriptSeg {
  speaker: string | null;
  text: string;
}

const MAX_CHARS = 24000;

export function buildTranscriptText(segments: TranscriptSeg[]): string {
  const lines: string[] = [];
  let total = 0;
  let truncated = false;
  for (const s of segments) {
    const text = s.text?.trim();
    if (!text) continue;
    const line = `${s.speaker?.trim() || 'Спикер'}: ${text}`;
    if (total + line.length + 1 > MAX_CHARS) {
      truncated = true;
      break;
    }
    lines.push(line);
    total += line.length + 1;
  }
  let out = lines.join('\n');
  if (truncated) out += '\n[транскрипт усечён]';
  return out;
}
```

- [ ] **Step 4:** `transcript.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildTranscriptText } from './transcript.js';

describe('buildTranscriptText', () => {
  it('formats speaker lines in given order', () => {
    const out = buildTranscriptText([
      { speaker: 'Аня', text: 'Привет' },
      { speaker: 'Боб', text: 'Здорово' },
    ]);
    expect(out).toBe('Аня: Привет\nБоб: Здорово');
  });
  it('skips empty/whitespace segments and falls back speaker', () => {
    const out = buildTranscriptText([
      { speaker: null, text: 'Раз' },
      { speaker: 'X', text: '   ' },
    ]);
    expect(out).toBe('Спикер: Раз');
  });
  it('truncates very long transcripts with a marker', () => {
    const long = Array.from({ length: 5000 }, () => ({ speaker: 'A', text: 'слово слово слово' }));
    const out = buildTranscriptText(long);
    expect(out.endsWith('[транскрипт усечён]')).toBe(true);
    expect(out.length).toBeLessThan(24100);
  });
});
```

- [ ] **Step 5:** `openrouter.test.ts` (только чистый `parseJsonContent`, без сети):
```ts
import { describe, it, expect } from 'vitest';
import { parseJsonContent } from './openrouter.js';

describe('parseJsonContent', () => {
  it('parses plain JSON', () => {
    expect(parseJsonContent('{"a":1}')).toEqual({ a: 1 });
  });
  it('parses fenced ```json blocks', () => {
    expect(parseJsonContent('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  it('throws SyntaxError on garbage', () => {
    expect(() => parseJsonContent('not json')).toThrow();
  });
});
```

- [ ] **Step 6:** В `packages/backend/.env.example` добавить (со значениями-примерами, без реального ключа):
```
# LLM (OpenRouter) — опционально; без ключа анализ отключён (503)
OPENROUTER_API_KEY=
LLM_MODEL_DETAILED=anthropic/claude-sonnet-4.5
LLM_MODEL_LIVE=anthropic/claude-haiku-4.5
```

- [ ] **Step 7: Verify** — `npm run type-check` (корень) зелёный; `npm run test --workspace=@livescribe/backend` — новые тесты проходят.

- [ ] **Step 8: Commit**
```bash
git add packages/backend/src/llm packages/backend/.env.example
git commit -m "feat(backend): LLM core — OpenRouter client, config, transcript builder"
```

---

### Task 2: analysis-профиль + эндпоинт `POST /api/meetings/:id/analysis` + DTO

**Files:**
- Create: `packages/backend/src/llm/analysis.ts`
- Create: `packages/backend/src/llm/analysis.test.ts`
- Modify: `packages/backend/src/api/meetings-routes.ts`
- Modify: `packages/shared/src/domain.ts`

**Interfaces:**
- Consumes: `chatJson`, `getDetailedModel`, `buildTranscriptText`/`TranscriptSeg`, `isLlmConfigured` (Task 1); `requireUser`, `prisma`.
- Produces: `analyzeMeeting(segments, deps?)`, `coerceAnalysis(raw)`, типы `ActionItem`/`MeetingAnalysis` (analysis.ts); эндпоинт; расширенные `AnalysisDTO`/`ActionItem` в shared.

- [ ] **Step 1:** Расширить `packages/shared/src/domain.ts` — заменить строку `export interface AnalysisDTO { summary: string | null; actionItems: unknown | null; }` на:
```ts
export interface ActionItem { text: string; owner?: string; }
export interface AnalysisDTO { summary: string | null; actionItems: ActionItem[] | null; createdAt?: string | null; }
```

- [ ] **Step 2:** `analysis.ts`:
```ts
import { chatJson, type ChatArgs } from './openrouter.js';
import { getDetailedModel } from './config.js';
import { buildTranscriptText, type TranscriptSeg } from './transcript.js';

export interface ActionItem { text: string; owner?: string; }
export interface MeetingAnalysis { summary: string; actionItems: ActionItem[]; }

const SYSTEM = [
  'Ты — ассистент, который анализирует расшифровку деловой встречи.',
  'Верни JSON-объект с полями: "summary" (строка, 1 краткий абзац сути встречи) и',
  '"actionItems" (массив объектов {"text": строка, "owner"?: строка} — конкретные задачи/договорённости).',
  'Пиши на языке расшифровки (русский или английский). Если задач нет — пустой массив.',
].join(' ');

export function coerceAnalysis(raw: unknown): MeetingAnalysis {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  const itemsRaw = Array.isArray(obj.actionItems) ? obj.actionItems : [];
  const actionItems = itemsRaw
    .map((it): ActionItem | null => {
      if (typeof it === 'string') return it.trim() ? { text: it.trim() } : null;
      if (it && typeof it === 'object') {
        const text = typeof (it as Record<string, unknown>).text === 'string' ? ((it as Record<string, unknown>).text as string).trim() : '';
        const ownerRaw = (it as Record<string, unknown>).owner;
        const owner = typeof ownerRaw === 'string' && ownerRaw.trim() ? ownerRaw.trim() : undefined;
        return text ? { text, ...(owner ? { owner } : {}) } : null;
      }
      return null;
    })
    .filter((x): x is ActionItem => x !== null);
  return { summary, actionItems };
}

export async function analyzeMeeting(
  segments: TranscriptSeg[],
  deps: { chat?: (args: ChatArgs) => Promise<unknown> } = {}
): Promise<MeetingAnalysis> {
  const chat = deps.chat ?? chatJson;
  const transcript = buildTranscriptText(segments);
  const raw = await chat({
    model: getDetailedModel(),
    system: SYSTEM,
    user: `Расшифровка встречи:\n\n${transcript}`,
    maxTokens: 1500,
  });
  return coerceAnalysis(raw);
}
```

- [ ] **Step 3:** `analysis.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { coerceAnalysis, analyzeMeeting } from './analysis.js';

describe('coerceAnalysis', () => {
  it('keeps valid summary + object/string action items', () => {
    const out = coerceAnalysis({
      summary: 'Итог',
      actionItems: [{ text: 'Сделать X', owner: 'Аня' }, 'Позвонить Бобу', { text: '' }, 42],
    });
    expect(out.summary).toBe('Итог');
    expect(out.actionItems).toEqual([{ text: 'Сделать X', owner: 'Аня' }, { text: 'Позвонить Бобу' }]);
  });
  it('normalizes missing/garbage to empty', () => {
    expect(coerceAnalysis(null)).toEqual({ summary: '', actionItems: [] });
    expect(coerceAnalysis({ actionItems: 'nope' })).toEqual({ summary: '', actionItems: [] });
  });
});

describe('analyzeMeeting', () => {
  it('builds transcript and coerces injected chat result', async () => {
    let seenUser = '';
    const out = await analyzeMeeting(
      [{ speaker: 'Аня', text: 'Запустим проект' }],
      { chat: async (args) => { seenUser = args.user; return { summary: 'S', actionItems: [{ text: 'T' }] }; } }
    );
    expect(seenUser).toContain('Аня: Запустим проект');
    expect(out).toEqual({ summary: 'S', actionItems: [{ text: 'T' }] });
  });
});
```

- [ ] **Step 4:** В `meetings-routes.ts` добавить импорты и новый роут. Импорты (верх файла):
```ts
import { isLlmConfigured } from '../llm/config.js';
import { analyzeMeeting } from '../llm/analysis.js';
import type { ActionItem } from '@livescribe/shared';
```
Внутри `registerMeetingRoutes`, после существующего `GET /api/meetings/:id`:
```ts
  server.post('/api/meetings/:id/analysis', async (req, reply) => {
    const u = await requireUser(req, reply); if (!u) return;
    if (!isLlmConfigured()) return reply.code(503).send({ error: 'analysis_unavailable' });
    const { id } = req.params as { id: string };
    const m = await prisma.meeting.findFirst({
      where: { id, userId: u.id },
      include: { segments: { where: { isFinal: true }, orderBy: { tsMs: 'asc' } } },
    });
    if (!m) return reply.code(404).send({ error: 'not_found' });
    if (m.segments.length === 0) return reply.code(400).send({ error: 'no_transcript' });

    let result;
    try {
      result = await analyzeMeeting(m.segments.map((s) => ({ speaker: s.speaker, text: s.text })));
    } catch (err) {
      req.log.error({ err }, 'analysis failed');
      return reply.code(502).send({ error: 'analysis_failed' });
    }

    const saved = await prisma.analysis.upsert({
      where: { meetingId: m.id },
      create: { meetingId: m.id, summary: result.summary, actionItems: result.actionItems as unknown as object },
      update: { summary: result.summary, actionItems: result.actionItems as unknown as object, createdAt: new Date() },
    });
    return {
      summary: saved.summary,
      actionItems: saved.actionItems as ActionItem[] | null,
      createdAt: saved.createdAt.toISOString(),
    };
  });
```

- [ ] **Step 5:** В том же файле расширить сериализацию `analysis` в `GET /api/meetings/:id` — добавить `createdAt` и типизировать `actionItems`:
```ts
      analysis: m.analysis
        ? {
            summary: m.analysis.summary,
            actionItems: m.analysis.actionItems as ActionItem[] | null,
            createdAt: m.analysis.createdAt.toISOString(),
          }
        : null,
```

- [ ] **Step 6: Verify** — `npm run type-check` (корень) зелёный; `npm run test --workspace=@livescribe/backend` — все тесты (вкл. analysis) проходят. (Реальный вызов OpenRouter НЕ требуется — тесты мокают `chat`.)

- [ ] **Step 7: Commit**
```bash
git add packages/backend/src/llm/analysis.ts packages/backend/src/llm/analysis.test.ts packages/backend/src/api/meetings-routes.ts packages/shared/src/domain.ts
git commit -m "feat(backend): meeting analysis endpoint (OpenRouter) + shared AnalysisDTO"
```

---

### Task 3: Кабинет — кнопка «Проанализировать» + отображение анализа

**Files:**
- Modify: `packages/admin/src/api.ts`
- Modify: `packages/admin/src/pages/MeetingDetailPage.tsx`
- Modify: `packages/admin/src/pages/MeetingDetailPage.module.scss`

**Interfaces:**
- Consumes: эндпоинт `POST /api/meetings/:id/analysis`, `AnalysisDTO` (Task 2).
- Produces: `analyzeMeeting(id)` в admin `api.ts`; панель анализа в `MeetingDetailPage`.

- [ ] **Step 1:** В `packages/admin/src/api.ts` — добавить `AnalysisDTO` в импорт типов из `@livescribe/shared` и функцию:
```ts
export const analyzeMeeting = (id: string) => req<AnalysisDTO>(`/meetings/${id}/analysis`, { method: 'POST' });
```
(POST без тела — `req` не пошлёт `content-type`, бэк не потребует JSON-body.)

- [ ] **Step 2:** В `MeetingDetailPage.tsx` — импортировать `AnalysisDTO` + `analyzeMeeting`, добавить состояние и обработчик. Импорты:
```ts
import type { MeetingDetailDTO, AnalysisDTO } from '@livescribe/shared';
import { getMeeting, analyzeMeeting } from '../api';
```
Состояние (рядом с `meeting`/`status`):
```ts
  const [analysis, setAnalysis] = useState<AnalysisDTO | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
```
В `useEffect`-загрузке проставлять анализ из встречи — заменить `.then((m) => { setMeeting(m); setStatus('ready'); })` на:
```ts
      .then((m) => { setMeeting(m); setAnalysis(m.analysis); setStatus('ready'); })
```
Обработчик (внутри компонента):
```ts
  async function runAnalysis() {
    if (!id) return;
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const a = await analyzeMeeting(id);
      setAnalysis(a);
    } catch (e) {
      const code = (e as Error).message;
      setAnalysisError(
        code === 'analysis_unavailable' ? 'Анализ недоступен: не настроен LLM-ключ.'
          : code === 'no_transcript' ? 'Нет транскрипта для анализа.'
          : 'Не удалось проанализировать. Попробуйте ещё раз.'
      );
    } finally {
      setAnalyzing(false);
    }
  }
```

- [ ] **Step 3:** Заменить блок `<aside className={styles.analysis}>…</aside>` на:
```tsx
        <aside className={styles.analysis}>
          <h2 className={styles.sectionTitle}>Анализ</h2>
          {analysis?.summary ? (
            <>
              <p className={styles.summary}>{analysis.summary}</p>
              {analysis.actionItems && analysis.actionItems.length > 0 && (
                <>
                  <h3 className={styles.subTitle}>Задачи</h3>
                  <ul className={styles.actionItems}>
                    {analysis.actionItems.map((it, i) => (
                      <li key={i}>{it.owner ? <strong>{it.owner}: </strong> : null}{it.text}</li>
                    ))}
                  </ul>
                </>
              )}
              <button className={styles.analyzeBtn} onClick={runAnalysis} disabled={analyzing}>
                {analyzing ? 'Анализируем…' : 'Перегенерировать'}
              </button>
            </>
          ) : (
            <>
              <p className="muted">Анализа пока нет.</p>
              <button className={styles.analyzeBtn} onClick={runAnalysis} disabled={analyzing}>
                {analyzing ? 'Анализируем…' : 'Проанализировать'}
              </button>
            </>
          )}
          {analysisError && <p className={styles.error}>{analysisError}</p>}
        </aside>
```

- [ ] **Step 4:** В `MeetingDetailPage.module.scss` добавить стили (акцент `#0d9488`):
```scss
.summary { line-height: 1.55; margin-bottom: 12px; white-space: pre-wrap; }
.subTitle { font-size: 13px; font-weight: 600; margin: 8px 0 4px; }
.actionItems { margin: 0 0 12px; padding-left: 18px; line-height: 1.5;
  li { margin-bottom: 4px; } }
.analyzeBtn {
  padding: 8px 14px; background: #0d9488; color: #fff; border: none; border-radius: 6px;
  font-size: 13px; font-weight: 500; cursor: pointer;
  &:disabled { opacity: 0.6; cursor: default; }
}
```

- [ ] **Step 5: Verify.** `npm run type-check` (корень) зелёный; `npm run build --workspace=@livescribe/admin` собирается. Живая проверка требует запущенного бэка + `OPENROUTER_API_KEY` + сид-встречи с сегментами: если ключ доступен локально — прогнать в браузере (кнопка → «Анализируем…» → саммари + задачи; перегенерация; кейс без ключа → сообщение). Если недоступно в среде — собрать, выверить логику чтением и явно указать в отчёте, что живая проверка (реальный LLM + браузер) за пользователем/деплоем.

- [ ] **Step 6: Commit**
```bash
git add packages/admin/src/api.ts packages/admin/src/pages/MeetingDetailPage.tsx packages/admin/src/pages/MeetingDetailPage.module.scss
git commit -m "feat(admin): meeting analysis panel — generate + show summary/action items"
```

---

## Self-Review

- **Spec coverage:** LLM-ядро (config/openrouter/transcript) → Task 1; analysis-профиль + эндпоинт (503/404/400/502, upsert) + DTO createdAt → Task 2; кнопка + отображение саммари/action items + состояния/ошибки → Task 3. Тесты ядра → Task 1/2. Env-конфиг → Task 1 Step 6.
- **Placeholder scan:** весь ключевой код приведён (клиент, парс, транскрипт, coerce, эндпоинт, api, UI, стили); тестовые тела — конкретные.
- **Type consistency:** `AnalysisDTO { summary, actionItems: ActionItem[]|null, createdAt? }` — согласован между shared, эндпоинтом (`saved.actionItems as ActionItem[]|null`, `createdAt.toISOString()`), admin `api.ts` (`req<AnalysisDTO>`) и `MeetingDetailPage`. `ActionItem { text; owner? }` определён в shared и локально в analysis.ts (совпадают по форме; endpoint импортирует shared-версию). `chatJson(ChatArgs)` / `analyzeMeeting(segments, {chat})` — сигнатуры совпадают между Task 1 и Task 2. `buildTranscriptText(TranscriptSeg[])` — используется в analysis.ts.

## Вне плана (follow-up)
- Деплой: добавить `OPENROUTER_API_KEY` (+ модели) в prod-`.env` на сервере — иначе кабинет вернёт 503 (обновить deploy-скилл).
- Под-проект B: live-саммари в расширении (`POST /api/meetings/:id/live-summary`, `getLiveModel()`, эфемерно, кнопка в виджете) — отдельные спека/план.
- ADR о выборе OpenRouter как LLM-провайдера.
- Опц.: «ключевые моменты», авто-анализ при завершении встречи, лимиты/стоимость.
