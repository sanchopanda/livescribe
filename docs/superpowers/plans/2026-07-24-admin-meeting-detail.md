# Admin meeting detail Implementation Plan (LS-08 sub-plan 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Страница одной встречи (`/meetings/:id`): шапка + транскрипт по спикерам + панель-заглушка анализа; карточки списка становятся ссылками на неё.

**Architecture:** Тонкий слой поверх готового `GET /api/meetings/:id` (возвращает `MeetingDetailDTO` с `segments[]` + `analysis`). Новый `getMeeting(id)` в api, страница `MeetingDetailPage`, маршрут `meetings/:id` под `CabinetLayout`, карточки `MeetingsPage` → `<Link>`.

**Tech Stack:** React 19, React Router 7 (`useParams`, `Link`), CSS Modules + Sass, `@livescribe/shared` (`MeetingDetailDTO`, `TranscriptSegmentDTO`). Backend `GET /api/meetings/:id` уже готов (user-scoped, 404 на чужой/несуществующий).

## Global Constraints

- CSS Modules + Sass, акцент `#0d9488`, без Tailwind. Русский UI, английские идентификаторы.
- Fetch через существующий `req()` (`credentials:'include'`, база `/api`).
- DTO из `@livescribe/shared` — не дублировать. Форматтеры из `lib/format.ts` переиспользовать.
- Root `npm run type-check` (incl. admin) зелёный перед коммитом.
- Анализ пока пустой (`analysis: null` до LS-09) → показывать заглушку, не ошибку.

## File Structure

- Modify `packages/admin/src/api.ts` — `getMeeting`.
- Create `packages/admin/src/pages/MeetingDetailPage.tsx` + `MeetingDetailPage.module.scss`.
- Modify `packages/admin/src/pages/MeetingsPage.tsx` — карточки в `<Link>`.
- Modify `packages/admin/src/main.tsx` — маршрут `meetings/:id`.

---

### Task 1: `getMeeting` + страница карточки встречи

**Files:**
- Modify: `packages/admin/src/api.ts`
- Create: `packages/admin/src/pages/MeetingDetailPage.tsx`, `packages/admin/src/pages/MeetingDetailPage.module.scss`

**Interfaces:**
- Produces: `getMeeting(id: string): Promise<MeetingDetailDTO>`; `MeetingDetailPage` (route component reading `:id` via `useParams`).

- [ ] **Step 1: В `api.ts`** — добавить `MeetingDetailDTO` в импорт из `@livescribe/shared` и:

```ts
export const getMeeting = (id: string) => req<MeetingDetailDTO>(`/meetings/${id}`);
```

- [ ] **Step 2: `MeetingDetailPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { MeetingDetailDTO } from '@livescribe/shared';
import { getMeeting } from '../api';
import { formatDate, formatDuration, platformLabel } from '../lib/format';
import styles from './MeetingDetailPage.module.scss';

type Status = 'loading' | 'ready' | 'notfound' | 'error';

export function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [meeting, setMeeting] = useState<MeetingDetailDTO | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    if (!id) return;
    setStatus('loading');
    getMeeting(id)
      .then((m) => { setMeeting(m); setStatus('ready'); })
      .catch((err) => setStatus((err as Error).message === 'not_found' ? 'notfound' : 'error'));
  }, [id]);

  if (status === 'loading') return <div className={styles.page}><p className="muted">Загрузка…</p></div>;
  if (status === 'notfound') return <div className={styles.page}><p className="muted">Встреча не найдена.</p><Link to="/">← К списку</Link></div>;
  if (status === 'error' || !meeting) return <div className={styles.page}><p className={styles.error}>Не удалось загрузить встречу.</p><Link to="/">← К списку</Link></div>;

  return (
    <div className={styles.page}>
      <Link to="/" className={styles.back}>← Переговоры</Link>
      <h1 className={styles.title}>{meeting.title || platformLabel(meeting.platform)}</h1>
      <div className={styles.meta}>
        <span>{platformLabel(meeting.platform)}</span>
        <span>·</span><span>{formatDate(meeting.startedAt)}</span>
        <span>·</span><span>{formatDuration(meeting.durationSec)}</span>
        {meeting.participantsCount ? (<><span>·</span><span>{meeting.participantsCount} уч.</span></>) : null}
      </div>

      <div className={styles.body}>
        <section className={styles.transcript}>
          <h2 className={styles.sectionTitle}>Транскрипт</h2>
          {meeting.segments.length === 0 ? (
            <p className="muted">Пусто.</p>
          ) : (
            <ul className={styles.segments}>
              {meeting.segments.map((s) => (
                <li key={s.id} className={styles.segment}>
                  <span className={styles.speaker}>{s.speaker || 'Спикер'}</span>
                  <span className={styles.text}>{s.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className={styles.analysis}>
          <h2 className={styles.sectionTitle}>Анализ</h2>
          {meeting.analysis?.summary ? (
            <p>{meeting.analysis.summary}</p>
          ) : (
            <p className="muted">Анализ появится позже.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `MeetingDetailPage.module.scss`** — `@use '../styles/tokens' as *;`. `.page` gap-стек; `.back` — ссылка `$text-muted`, hover `$accent`; `.title` 600 крупный; `.meta` — flex gap 8px `$text-muted` 13px; `.body` — grid `1fr 320px` (на узком экране в столбец через `@media`); `.transcript`/`.analysis` — карточки (белый фон, бордер `$border`, radius `$radius`, padding 16px); `.sectionTitle` 14px `$text-muted` uppercase; `.segments` — стек без маркеров gap 10px; `.segment` — flex-col, `.speaker` 600 13px `$accent`, `.text` — обычный; `.error` `#dc2626`.

- [ ] **Step 4: Verify** — `npm run type-check` (корень) зелёный.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/src/api.ts packages/admin/src/pages/MeetingDetailPage.tsx packages/admin/src/pages/MeetingDetailPage.module.scss
git commit -m "feat(admin): meeting detail page (transcript + analysis placeholder)"
```

### Task 2: Маршрут + кликабельные карточки + браузерная проверка

**Files:**
- Modify: `packages/admin/src/main.tsx`, `packages/admin/src/pages/MeetingsPage.tsx`

**Interfaces:**
- Consumes: `MeetingDetailPage`.
- Produces: маршрут `meetings/:id`; карточки списка — ссылки на `/meetings/:id`.

- [ ] **Step 1: `main.tsx`** — импортировать `MeetingDetailPage`, добавить под `CabinetLayout` рядом с `settings`:

```tsx
<Route path="meetings/:id" element={<MeetingDetailPage />} />
```

- [ ] **Step 2: `MeetingsPage.tsx`** — обернуть карточку в `Link` (импорт `Link` из `react-router-dom`): заменить `<li className={styles.card}>…</li>` на `<li><Link to={`/meetings/${m.id}`} className={styles.card}>…</Link></li>` (перенести класс `card` на `Link`; добавить в scss `.card { text-decoration: none; color: inherit; display: block; }` и hover-состояние с бордером `$accent`).

- [ ] **Step 3: Verify (браузер)** — Postgres up, backend+admin запущены. Зарегистрировать юзера; засидить встречу С СЕГМЕНТАМИ: вставить `Meeting` + пару `TranscriptSegment` (разные `speaker`/`text`/`tsMs`) под юзера через `psql`. Через Chrome DevTools MCP: список → клик по карточке → открывается `/meetings/:id` с шапкой + транскриптом (реплики по спикерам) + панель «Анализ появится позже»; «← Переговоры» возвращает в список; заход на несуществующий `/meetings/zzz` → «Встреча не найдена». Консоль чистая. Скриншот карточки встречи. Почистить сид + юзера, остановить процессы. `npm run type-check` зелёный.

- [ ] **Step 4: docs** — `PROGRESS.md`/`backlog.md`: sub-plan 4 готов; LS-08 (кабинет-MVP) закрыт; следующее — деплой кабинета на `app.skribo.ru` и/или LS-09 (анализ).

- [ ] **Step 5: Commit**

```bash
git add packages/admin/src/main.tsx packages/admin/src/pages/MeetingsPage.tsx docs/PROGRESS.md docs/backlog.md
git commit -m "feat(admin): route + clickable cards for meeting detail; docs (sub-plan 4 done)"
```

---

## Self-Review

- **Spec coverage** (spec §3 «Карточка встречи»: шапка + транскрипт по спикерам + панель AI-саммари/action items заглушкой): шапка+транскрипт+заглушка → Task 1; навигация из списка → Task 2. Анализ пустой до LS-09 — заглушка, не ошибка (учтено).
- **Placeholder scan:** код страницы/api приведён; scss задан правилами; браузерная проверка с конкретными шагами и сид-данными.
- **Type consistency:** `getMeeting(id)`→`MeetingDetailDTO`; `MeetingDetailPage` через `useParams`; `segments`/`analysis` из `MeetingDetailDTO` (`packages/shared/src/domain.ts`); форматтеры те же, что в списке.

## Вне плана (follow-up)
- Мерж последовательных реплик одного спикера / таймкоды — по желанию позже.
- Реальный анализ (summary/action items) — LS-09.
- Деплой кабинета на `app.skribo.ru` — deploy-time.
