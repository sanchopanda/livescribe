# Admin meetings list Implementation Plan (LS-08 sub-plan 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить заглушку `MeetingsPage` на реальный список переговоров: загрузка `GET /api/meetings`, карточки встреч, поиск и сортировка, состояния loading/empty/error.

**Architecture:** Тонкий слой поверх готового API. `api.ts` получает `listMeetings(params)`; небольшой util форматирования (дата/длительность/платформа); `MeetingsPage` рендерит поиск + сортировку + список карточек через `MeetingDTO` из `@livescribe/shared`. Навигация в карточку встречи — в sub-plan 4 (здесь карточки пока не кликабельны).

**Tech Stack:** React 19, React Router 7, CSS Modules + Sass, `@livescribe/shared` (`MeetingDTO`). Backend `GET /api/meetings?q=&sort=` уже готов (user-scoped).

## Global Constraints

- CSS Modules + Sass (`*.module.scss`), акцент `#0d9488`, без Tailwind. Русский UI, английские идентификаторы.
- Fetch через существующий `req()` в `api.ts` (`credentials:'include'`, база `/api`).
- `MeetingDTO` из `@livescribe/shared` — не дублировать.
- Root `npm run type-check` (incl. admin) зелёный перед коммитом.
- Карточки НЕ навигируют в детали (маршрута `/meetings/:id` ещё нет — это sub-plan 4).

## File Structure

- Modify `packages/admin/src/api.ts` — добавить `listMeetings`.
- Create `packages/admin/src/lib/format.ts` — `formatDate`, `formatDuration`, `platformLabel`.
- Modify `packages/admin/src/pages/MeetingsPage.tsx` (+ `MeetingsPage.module.scss`) — реальный список.

---

### Task 1: `listMeetings` в api + утилиты форматирования

**Files:**
- Modify: `packages/admin/src/api.ts`
- Create: `packages/admin/src/lib/format.ts`

**Interfaces:**
- Produces: `listMeetings(params?: { q?: string; sort?: 'newest' | 'oldest' }): Promise<MeetingDTO[]>`; `formatDate(iso: string): string`, `formatDuration(sec: number | null): string`, `platformLabel(p: string | null): string`.

- [ ] **Step 1: В `packages/admin/src/api.ts`** — добавить импорт `MeetingDTO` и функцию:

```ts
import type { AuthResponse, LoginRequest, RegisterRequest, PersonalTokenDTO, MeetingDTO } from '@livescribe/shared';
// ...
export const listMeetings = (params?: { q?: string; sort?: 'newest' | 'oldest' }) => {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.sort) qs.set('sort', params.sort);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return req<MeetingDTO[]>(`/meetings${suffix}`);
};
```

- [ ] **Step 2: `packages/admin/src/lib/format.ts`**

```ts
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(sec: number | null): string {
  if (!sec || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m} мин${s ? ` ${s} с` : ''}`;
  const h = Math.floor(m / 60);
  return `${h} ч ${m % 60} мин`;
}

const PLATFORM_LABELS: Record<string, string> = {
  meet: 'Google Meet', zoom: 'Zoom', teams: 'MS Teams', pachca: 'Pachca',
};
export function platformLabel(p: string | null): string {
  if (!p) return 'Звонок';
  return PLATFORM_LABELS[p] ?? p;
}
```

- [ ] **Step 3: Verify** — `npm run type-check` (корень) зелёный.

- [ ] **Step 4: Commit**

```bash
git add packages/admin/src/api.ts packages/admin/src/lib/format.ts
git commit -m "feat(admin): listMeetings API call + formatting utils"
```

### Task 2: Страница списка переговоров

**Files:**
- Modify: `packages/admin/src/pages/MeetingsPage.tsx`, `packages/admin/src/pages/MeetingsPage.module.scss`

**Interfaces:**
- Consumes: `listMeetings`, `formatDate`/`formatDuration`/`platformLabel`, `MeetingDTO`, `TextField` (для поиска) или нативный input.
- Produces: `MeetingsPage` со списком, поиском (debounce), сортировкой, состояниями.

- [ ] **Step 1: Переписать `MeetingsPage.tsx`** — состояние: `meetings: MeetingDTO[]`, `status: 'loading'|'ready'|'error'`, `q: string`, `sort: 'newest'|'oldest'`. `useEffect` по `[q, sort]` вызывает `listMeetings({ q, sort })` (с debounce ~300мс на `q` — через `setTimeout`/cleanup). Рендер:
  - Заголовок «Переговоры».
  - Строка управления: поиск (input, placeholder «Поиск по названию…») + селект сортировки («Сначала новые»/«Сначала старые»).
  - `status==='loading'` → «Загрузка…»; `error` → «Не удалось загрузить» + кнопка «Повторить»; пустой список → «Пока нет переговоров. Начните запись в расширении.» (если `q` непустой — «Ничего не найдено»).
  - Иначе список карточек: каждая — название (`title || platformLabel(platform)`), строка мета: `platformLabel(platform)` · `formatDate(startedAt)` · `formatDuration(durationSec)` · участники (если есть). Карточка — `<div>` (пока не ссылка; навигация в sub-plan 4).

```tsx
import { useEffect, useRef, useState } from 'react';
import type { MeetingDTO } from '@livescribe/shared';
import { listMeetings } from '../api';
import { formatDate, formatDuration, platformLabel } from '../lib/format';
import styles from './MeetingsPage.module.scss';

export function MeetingsPage() {
  const [meetings, setMeetings] = useState<MeetingDTO[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setStatus('loading');
    const t = setTimeout(() => {
      listMeetings({ q: q.trim() || undefined, sort })
        .then((list) => { if (id === reqId.current) { setMeetings(list); setStatus('ready'); } })
        .catch(() => { if (id === reqId.current) setStatus('error'); });
    }, 300);
    return () => clearTimeout(t);
  }, [q, sort]);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Переговоры</h1>
      <div className={styles.controls}>
        <input className={styles.search} placeholder="Поиск по названию…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={styles.sort} value={sort} onChange={(e) => setSort(e.target.value as 'newest' | 'oldest')}>
          <option value="newest">Сначала новые</option>
          <option value="oldest">Сначала старые</option>
        </select>
      </div>
      {status === 'loading' && <p className="muted">Загрузка…</p>}
      {status === 'error' && (
        <p className={styles.error}>Не удалось загрузить. <button onClick={() => setSort((s) => s)}>Повторить</button></p>
      )}
      {status === 'ready' && meetings.length === 0 && (
        <p className="muted">{q.trim() ? 'Ничего не найдено' : 'Пока нет переговоров. Начните запись в расширении.'}</p>
      )}
      {status === 'ready' && meetings.length > 0 && (
        <ul className={styles.list}>
          {meetings.map((m) => (
            <li key={m.id} className={styles.card}>
              <div className={styles.cardTitle}>{m.title || platformLabel(m.platform)}</div>
              <div className={styles.cardMeta}>
                <span>{platformLabel(m.platform)}</span>
                <span>·</span><span>{formatDate(m.startedAt)}</span>
                <span>·</span><span>{formatDuration(m.durationSec)}</span>
                {m.participantsCount ? (<><span>·</span><span>{m.participantsCount} уч.</span></>) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```
(Примечание: кнопка «Повторить» через `setSort((s)=>s)` не триггерит перезапрос — заменить на явный триггер: добавить состояние `reload: number` и включить его в deps `useEffect`, а кнопка делает `setReload(n=>n+1)`. Реализовать так, а не через no-op setSort.)

- [ ] **Step 2: `MeetingsPage.module.scss`** — `@use '../styles/tokens' as *;`. `.page` padding 24px; `.controls` flex gap; `.search` — input с бордером/радиусом/focus-accent; `.sort` — select; `.list` — grid/stack gap 12px без маркеров; `.card` — белый фон, бордер `$border`, radius `$radius`, padding 16px, hover — лёгкая тень/бордер `$accent`; `.cardTitle` — 600; `.cardMeta` — flex gap 8px, `$text-muted`, размер 13px; `.error` — `#dc2626`.

- [ ] **Step 3: Verify** — `npm run type-check` зелёный.

- [ ] **Step 4: Commit**

```bash
git add packages/admin/src/pages/MeetingsPage.tsx packages/admin/src/pages/MeetingsPage.module.scss
git commit -m "feat(admin): meetings list page (search, sort, states)"
```

### Task 3: Браузерная проверка + документация

**Files:** docs only

- [ ] **Step 1: Seed + browser-verify.** Postgres up (`docker compose up -d db`, 5433), backend + admin запущены. Зарегистрировать тестового пользователя. Засидить ему 2–3 встречи: проще всего вставить строки в БД напрямую (`docker compose exec -T db psql -U skribo -d skribo`) — `INSERT INTO "Meeting" ("id","userId","platform","title","startedAt","endedAt","durationSec","createdAt") VALUES (...)` с разными `startedAt`/`platform`/`title` под `userId` тестового юзера (взять из `SELECT id FROM "User" WHERE email=...`). Через Chrome DevTools MCP открыть `/` (список): убедиться, что карточки рендерятся (название/платформа/дата/длительность), поиск по названию фильтрует, переключение сортировки меняет порядок (новые↔старые), пустой поиск-мимо → «Ничего не найдено». Консоль чистая. Снять скриншот списка. Почистить сид-данные и тест-юзера. Остановить процессы. (Если MCP flaky — fallback: `listMeetings` через curl с cookie + подтвердить, что dev-сервер отдаёт страницу; указать это.)
- [ ] **Step 2: docs** — в `PROGRESS.md`/`backlog.md`: sub-plan 3 готов; следующий — sub-plan 4 (карточка встречи).
- [ ] **Step 3: Commit** (docs).

---

## Self-Review

- **Spec coverage:** список/история переговоров (spec §3 «Список переговоров»: поиск + сортировка + карточки + пустое состояние) → Tasks 1–2; браузерная проверка → Task 3. Карточка встречи (детали) — sub-plan 4, не здесь (карточки не кликабельны — отмечено).
- **Placeholder scan:** код страницы/утилит/api приведён; «Повторить» явно требует reload-триггера (не no-op) — отмечено в Step 1 Task 2; scss задан правилами.
- **Type consistency:** `listMeetings(params)`→`MeetingDTO[]`, `sort: 'newest'|'oldest'` согласовано между api и страницей; `MeetingDTO` из shared; форматтеры (`formatDate`/`formatDuration`/`platformLabel`) с фиксированными сигнатурами.

## Вне плана (follow-up)
- Навигация карточка→детали и сама страница `/meetings/:id` — sub-plan 4.
- `Meeting.title` пока не заполняется бэкендом (поиск по названию найдёт пусто, пока не появится генерация заголовков) — учтено, поиск работает, данные появятся с LS-09.
