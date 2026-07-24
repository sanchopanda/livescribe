# Extension auth (login popup, hybrid) Implementation Plan (LS-11)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать ручной ввод токена: логин в попапе расширения (email+пароль) + авто-подхват сессии кабинета; при успехе токен сохраняется и записи привязываются к аккаунту.

**Architecture:** Бэкенд получает 2 токен-выдающих эндпоинта. Расширение получает попап (React/Vite через @crxjs) с гибридным флоу: авто-подхват `app.skribo.ru` cookie → `extension-token`, иначе форма → `extension-login`. Токен кладётся в `chrome.storage.local.skriboToken` (WS-`start` уже его читает). Поле токена из виджета удаляется.

**Tech Stack:** Backend Fastify + Prisma; extension React 19 + Vite + @crxjs. Spec: `docs/superpowers/specs/2026-07-24-extension-auth-design.md`.

## Global Constraints

- WS-привязка остаётся токеном в `start` (не трогаем offscreen/service-worker чтение `skriboToken`).
- Токен-выдача идемпотентна по юзеру: у юзера ≤1 `PersonalToken` c `label='extension'` (ротация: удалить старый, создать новый, вернуть сырой один раз).
- Extension-fetch к `app.skribo.ru`/`api.skribo.ru` с `credentials:'include'`; base-URL'ы — build-time конфиг (dev → localhost, prod → домены), как `__WS_URL__`.
- English identifiers; Russian UI. `npm run type-check` + `npm run build:extension` зелёные перед коммитом.
- CORS бэкенда не менять (extension-запросы к разрешённым хостам вне CORS). Пароли — bcrypt (существующие хелперы).

## File Structure

- Modify `packages/backend/src/auth/routes.ts` (или новый `src/auth/extension-routes.ts`) — 2 эндпоинта + `getOrRotateExtensionToken` helper.
- Test `packages/backend/src/auth/extension-token.test.ts` (helper logic, если чисто) — опционально по месту.
- Create `packages/extension/src/popup/index.html`, `src/popup/main.tsx`, `src/popup/App.tsx`, `src/popup/popup.css`, `src/popup/auth-api.ts`.
- Modify `packages/extension/public/manifest.json` (`action.default_popup`, `default_title`, host_permissions явные), `packages/extension/vite.config.ts` (define `__API_URL__`,`__CABINET_URL__`), `packages/extension/src/content/content.ts` (убрать поле токена).

---

### Task 1: Бэкенд — extension-token / extension-login

**Files:**
- Modify: `packages/backend/src/auth/routes.ts`
- (Test: `packages/backend/src/auth/extension-token.test.ts` если выделяется чистая логика)

**Interfaces:**
- Produces: `POST /api/auth/extension-token` (cookie-authed → `{ token }`), `POST /api/auth/extension-login` (`{email,password}` → `{ user, token }`); helper `getOrRotateExtensionToken(userId): Promise<string>`.

- [ ] **Step 1: Хелпер + эндпоинты в `routes.ts`** (внутри `registerAuthRoutes`, рядом с существующими). Импортировать `generateToken` из `./tokens.js`.

```ts
// helper: ensure the user has exactly one 'extension'-labeled token, return a fresh raw token
async function getOrRotateExtensionToken(userId: string): Promise<string> {
  await prisma.personalToken.deleteMany({ where: { userId, label: 'extension' } });
  const { raw, hash } = generateToken();
  await prisma.personalToken.create({ data: { userId, tokenHash: hash, label: 'extension' } });
  return raw;
}
```

```ts
server.post('/api/auth/extension-token', async (req, reply) => {
  const u = await requireUser(req, reply); if (!u) return;
  const token = await getOrRotateExtensionToken(u.id);
  return { token };
});

server.post('/api/auth/extension-login', async (req, reply) => {
  const body = req.body as { email?: unknown; password?: unknown };
  if (typeof body?.email !== 'string' || !body.email || typeof body?.password !== 'string' || !body.password)
    return reply.code(400).send({ error: 'invalid_input' });
  const email = body.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(body.password, user.passwordHash)))
    return reply.code(401).send({ error: 'invalid_credentials' });
  const token = await getOrRotateExtensionToken(user.id);
  return { user: { id: user.id, email: user.email, name: user.name }, token };
});
```
(`verifyPassword` уже импортирован в routes.ts из Task-4 фундамента; если нет — добавить импорт.)

- [ ] **Step 2: Verify (curl, с локальным Postgres на 5433 + `npm run dev:backend`):**
  - register/login → получить cookie; `POST /api/auth/extension-token` с cookie → `{token}` (64 hex); без cookie → 401.
  - `POST /api/auth/extension-login {email,password}` верные → `{user,token}`; неверный пароль → 401; нестроковое тело → 400.
  - Дважды вызвать extension-token → в БД у юзера ровно один токен с `label='extension'` (`select count(*) ... where label='extension'`).
  - `npm run type-check` зелёный.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/auth/routes.ts
git commit -m "feat(backend): extension-token + extension-login endpoints (rotating extension token)"
```

### Task 2: Расширение — попап + гибридный флоу + чистка виджета

**Files:**
- Create: `packages/extension/src/popup/index.html`, `main.tsx`, `App.tsx`, `popup.css`, `auth-api.ts`
- Modify: `packages/extension/public/manifest.json`, `packages/extension/vite.config.ts`, `packages/extension/src/content/content.ts`

**Interfaces:**
- Consumes: backend `/api/auth/{me,extension-token,extension-login}`.
- Produces: попап с auth; `chrome.storage.local.skriboToken` заполняется/очищается.

- [ ] **Step 1: `vite.config.ts` — build-time base URLs** (рядом с `__WS_URL__`):

```ts
const API_URL = process.env.API_URL || 'http://localhost:3001';       // backend host (login)
const CABINET_URL = process.env.CABINET_URL || 'http://localhost:5173'; // cabinet host (auto-detect)
// в defineConfig.define:
__API_URL__: JSON.stringify(API_URL),
__CABINET_URL__: JSON.stringify(CABINET_URL),
```

- [ ] **Step 2: `manifest.json`** — в `action`: `"default_popup": "src/popup/index.html"`, `"default_title": "Skribo"`. В `host_permissions` добавить явно `"https://app.skribo.ru/*"`, `"https://api.skribo.ru/*"` (в дополнение к `<all_urls>`).

- [ ] **Step 3: `src/popup/index.html`** — минимальный HTML c `<div id="root">` + `<script type="module" src="./main.tsx">`, `width:320px` в стиле.

- [ ] **Step 4: `src/popup/auth-api.ts`** — гибридные вызовы:

```ts
declare const __API_URL__: string;
declare const __CABINET_URL__: string;

export interface Account { email: string; via: 'cabinet' | 'login'; }

async function jsonOrNull(res: Response): Promise<any> { try { return await res.json(); } catch { return null; } }

// auto-detect: cabinet session → extension token
export async function tryAutoDetect(): Promise<Account | null> {
  try {
    const me = await fetch(`${__CABINET_URL__}/api/auth/me`, { credentials: 'include' });
    if (!me.ok) return null;
    const meBody = await jsonOrNull(me);
    const tok = await fetch(`${__CABINET_URL__}/api/auth/extension-token`, { method: 'POST', credentials: 'include' });
    if (!tok.ok) return null;
    const { token } = await jsonOrNull(tok);
    if (!token) return null;
    await chrome.storage.local.set({ skriboToken: token, skriboAccountEmail: meBody?.user?.email ?? null });
    return { email: meBody?.user?.email ?? '', via: 'cabinet' };
  } catch { return null; }
}

export async function loginWithPassword(email: string, password: string): Promise<Account> {
  const res = await fetch(`${__API_URL__}/api/auth/extension-login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) { const b = await jsonOrNull(res); throw new Error(b?.error || `HTTP ${res.status}`); }
  const { user, token } = await jsonOrNull(res);
  await chrome.storage.local.set({ skriboToken: token, skriboAccountEmail: user?.email ?? null });
  return { email: user?.email ?? email, via: 'login' };
}

export async function currentAccount(): Promise<string | null> {
  const { skriboAccountEmail } = await chrome.storage.local.get('skriboAccountEmail');
  return typeof skriboAccountEmail === 'string' ? skriboAccountEmail : null;
}

export async function signOut(): Promise<void> {
  await chrome.storage.local.remove(['skriboToken', 'skriboAccountEmail']);
}
```

- [ ] **Step 5: `src/popup/App.tsx`** — состояние `status: 'loading'|'authed'|'guest'`, `email`. На маунт: если уже есть `skriboToken`+email в storage → authed; иначе `tryAutoDetect()` → authed или guest. Guest → форма email+пароль (`loginWithPassword`, ошибки: `invalid_credentials`→«Неверный email или пароль», `invalid_input`→«Заполните поля»), ссылка «Регистрация в кабинете» (`__CABINET_URL__`, `target=_blank`). Authed → «Вошли как <email>» + «Выйти» (`signOut()` → guest) + ссылка «Открыть кабинет». `main.tsx` рендерит `<App/>`.

- [ ] **Step 6: `popup.css`** — акцент `#0d9488`, чистый компактный вид (ширина ~320px), кнопка-пилюля, инпуты.

- [ ] **Step 7: `content.ts`** — удалить поле ввода токена и его обработчик из виджета (добавленные в фиче привязки); чтение `skriboToken` в service-worker/offscreen НЕ трогать.

- [ ] **Step 8: Verify** — `npm run type-check` зелёный; `npm run build:extension` собирается и в `dist` есть `popup` (index.html + бандл). Grep: `content.ts` больше не содержит поля токена.

- [ ] **Step 9: Commit**

```bash
git add packages/extension/src/popup packages/extension/public/manifest.json packages/extension/vite.config.ts packages/extension/src/content/content.ts
git commit -m "feat(extension): account popup with hybrid auth (cabinet auto-detect + email/password); remove manual token field"
```

### Task 3: Сквозная проверка (оба пути)

**Files:** none (verification + docs)

- [ ] **Step 1: Fallback-логин (гарантированно проверяемый).** Postgres 5433 + `npm run dev:backend`; собрать расширение в dev (`npm run build:extension`, base-URL'ы localhost) и загрузить `dist` в Chrome (unpacked). Открыть попап → форма → войти зарегистрированным юзером → «Вошли как …»; проверить `chrome.storage.local.skriboToken` заполнен. Затем запустить запись на тест-странице/через WS-клиент с этим токеном (или на реальном Meet) → в БД появляется `Meeting` у юзера. (Через Chrome DevTools MCP или вручную — задокументировать что реально прогнали.)
- [ ] **Step 2: Авто-подхват (best-effort).** Залогиниться в кабинете (dev: localhost:5173) в том же браузере; открыть попап заново (после `signOut`) → проверить, срабатывает ли `tryAutoDetect` (authed без ввода). **Явно записать результат**: работает ли cookie-подхват в этом Chrome. Если нет — зафиксировать как известное ограничение (fallback остаётся основным).
- [ ] **Step 3: docs** — `PROGRESS.md`/`backlog.md`: LS-11 готов (с пометкой статуса авто-подхвата). Commit docs.

---

## Self-Review

- **Spec coverage:** эндпоинты extension-token/extension-login → Task 1; попап + гибрид + чистка виджета → Task 2; проверка обоих путей → Task 3. Ротация `extension`-токена (≤1 на юзера) → Task 1 helper. Риск авто-подхвата → Task 3 Step 2 (явно фиксируем).
- **Placeholder scan:** код эндпоинтов и auth-api приведён; попап-UI задан поведением + ключевым кодом; проверка с конкретными шагами и «записать результат авто-подхвата».
- **Type consistency:** `getOrRotateExtensionToken(userId)→raw`, `{token}` / `{user,token}` формы согласованы с фронтом (`tryAutoDetect`/`loginWithPassword`); `skriboToken` — тот же ключ, что читает WS-`start`.

## Вне плана (follow-up)
- Прод-сборка расширения с `API_URL=https://api.skribo.ru CABINET_URL=https://app.skribo.ru WS_URL=wss://api.skribo.ru/ws` и публикация — deploy-time.
- OAuth/Google, регистрация в расширении — позже.
