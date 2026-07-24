# Admin SPA shell + auth pages Implementation Plan (LS-08 sub-plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поднять SPA-кабинет Skribo (`packages/admin`) со входом/регистрацией, защищённым app-shell и страницей настроек с персональным токеном — работающий локально против бэкенда (`/api`).

**Architecture:** Новый workspace `packages/admin` (Vite + React 19 + React Router 7), стили — CSS Modules + Sass (`*.module.scss`), Radix для сложных примитивов (позже). Auth — контекст поверх `/api/auth/*` (cookie-сессия), dev-proxy `/api` → бэкенд `:3001`. Раскладка и паттерны копируются из `../expeditor/apps/web`.

**Tech Stack:** React 19, react-dom 19, react-router-dom 7, Vite 6, sass, TypeScript 5, `@livescribe/shared` (DTO). Backend (sub-plan 1) уже отдаёт `/api/auth/{register,login,logout,me}`, `/api/tokens`.

## Global Constraints

- Стили — **CSS Modules + Sass** (`*.module.scss`), **без Tailwind**; общие токены/миксины в `src/styles/`. Акцент Skribo — **`#0D9488`** (тёмная бирюза).
- Стек и раскладка как в `../expeditor/apps/web`: `src/{api,auth,layout,pages,ui,styles}`; `main.tsx` c `BrowserRouter`+`AuthProvider`+`ProtectedRoute`.
- Fetch к API — **всегда** `credentials: 'include'` (cookie-сессия), база `/api`.
- Русский UI-текст; английские идентификаторы в коде.
- `npm run type-check` (корень) зелёный перед коммитом. Vite dev-порт **5173**, proxy `/api` → `http://localhost:3001`.
- DTO берём из `@livescribe/shared` (`AuthResponse`, `UserDTO`, `LoginRequest`, `RegisterRequest`, `PersonalTokenDTO`), не дублируем.
- Деплой на `app.skribo.ru` — вне этого плана (deploy-time, отдельно).

## File Structure

- Create `packages/admin/package.json`, `vite.config.ts`, `index.html`, `tsconfig.json`, `.gitignore`.
- Create `packages/admin/src/main.tsx` — роутинг.
- Create `packages/admin/src/api.ts` — fetch-обёртка + вызовы auth/tokens.
- Create `packages/admin/src/auth/AuthContext.tsx`, `src/auth/ProtectedRoute.tsx`.
- Create `packages/admin/src/styles/global.scss`, `src/styles/_tokens.scss`.
- Create `packages/admin/src/ui/Button.tsx` (+ `.module.scss`), `src/ui/TextField.tsx` (+ `.module.scss`).
- Create `packages/admin/src/layout/CabinetLayout.tsx` (+ `.module.scss`).
- Create `packages/admin/src/pages/LoginPage.tsx`, `RegisterPage.tsx`, `SettingsPage.tsx`, `MeetingsPage.tsx` (+ `.module.scss` each). `MeetingsPage` — заглушка (реальный список — sub-plan 3).
- Modify root `package.json` — скрипты `dev:admin`, `build:admin` (по аналогии с extension/backend).

---

### Task 1: Scaffold `packages/admin` (Vite + React + RR7)

**Files:**
- Create: `packages/admin/package.json`, `packages/admin/vite.config.ts`, `packages/admin/index.html`, `packages/admin/tsconfig.json`, `packages/admin/.gitignore`, `packages/admin/src/main.tsx`, `packages/admin/src/styles/global.scss`, `packages/admin/src/styles/_tokens.scss`
- Modify: root `package.json`

**Interfaces:**
- Produces: рабочий `packages/admin` workspace; `npm run dev --workspace=@livescribe/admin` поднимает Vite на :5173 с proxy `/api`→:3001; пустой роутер рендерит заглушку.

- [ ] **Step 1: `packages/admin/package.json`**

```json
{
  "name": "@livescribe/admin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@livescribe/shared": "*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.1.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "sass": "^1.83.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.7"
  }
}
```

- [ ] **Step 2: `packages/admin/vite.config.ts`** (dev-proxy на бэкенд :3001; пре-бандл shared)

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['@livescribe/shared'] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } },
  },
});
```

- [ ] **Step 3: `packages/admin/index.html`**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Skribo — кабинет</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: `packages/admin/tsconfig.json`** (как expeditor apps/web)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 5: `packages/admin/.gitignore`** — строки `dist` и `node_modules`.

- [ ] **Step 6: `packages/admin/src/styles/_tokens.scss`** (тема Skribo)

```scss
// Skribo design tokens
$accent: #0d9488;
$accent-hover: #0f766e;
$text: #111827;
$text-muted: #6b7280;
$border: #e5e7eb;
$bg: #ffffff;
$bg-subtle: #f9fafb;
$radius: 10px;
```

- [ ] **Step 7: `packages/admin/src/styles/global.scss`** (reset + базовые стили)

```scss
@use './tokens' as *;
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: $text; background: $bg-subtle;
}
a { color: $accent; text-decoration: none; }
.muted { color: $text-muted; }
```

- [ ] **Step 8: `packages/admin/src/main.tsx`** (минимальный роутер-скелет — расширится в Tasks 4–6)

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './styles/global.scss';

const root = document.getElementById('root');
if (!root) throw new Error('Не найден #root');

createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<div style={{ padding: 24 }}>Skribo кабинет — скоро</div>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
```

- [ ] **Step 9: root `package.json`** — добавить в `scripts`: `"dev:admin": "npm run dev --workspace=@livescribe/admin"`, `"build:admin": "npm run build --workspace=@livescribe/admin"`.

- [ ] **Step 10: install + verify** — `npm install` (корень) подхватывает новый workspace; `npm run type-check` (корень) зелёный; `npm run dev:admin` поднимает :5173 и рендерит заглушку (curl `-s localhost:5173` возвращает HTML с `#root`). Остановить dev после проверки.

- [ ] **Step 11: Commit**

```bash
git add packages/admin package.json package-lock.json
git commit -m "feat(admin): scaffold cabinet SPA (Vite+React+RR7, scss tokens, /api dev proxy)"
```

### Task 2: API-клиент + AuthContext + ProtectedRoute

**Files:**
- Create: `packages/admin/src/api.ts`, `packages/admin/src/auth/AuthContext.tsx`, `packages/admin/src/auth/ProtectedRoute.tsx`

**Interfaces:**
- Consumes: `@livescribe/shared` DTO (`UserDTO`, `AuthResponse`, `LoginRequest`, `RegisterRequest`, `PersonalTokenDTO`); backend `/api/auth/*`, `/api/tokens`.
- Produces: `api` (`getMe`, `login`, `register`, `logout`, `listTokens`, `createToken`, `deleteToken`); `AuthProvider`/`useAuth` (`status: 'loading'|'authed'|'guest'`, `me`, `refresh`, `signOut`); `ProtectedRoute`.

- [ ] **Step 1: `packages/admin/src/api.ts`**

```ts
import type { AuthResponse, LoginRequest, RegisterRequest, PersonalTokenDTO } from '@livescribe/shared';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { const body = await res.json(); if (body?.error) message = body.error; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const getMe = () => req<AuthResponse>('/auth/me');
export const login = (body: LoginRequest) => req<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) });
export const register = (body: RegisterRequest) => req<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(body) });
export const logout = () => req<{ ok: true }>('/auth/logout', { method: 'POST' });
export const listTokens = () => req<PersonalTokenDTO[]>('/tokens');
export const createToken = (label?: string) => req<PersonalTokenDTO>('/tokens', { method: 'POST', body: JSON.stringify({ label }) });
export const deleteToken = (id: string) => req<{ ok: true }>(`/tokens/${id}`, { method: 'DELETE' });
```

- [ ] **Step 2: `packages/admin/src/auth/AuthContext.tsx`** (паттерн expeditor, но без permissions)

```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { UserDTO } from '@livescribe/shared';
import { getMe, logout as apiLogout } from '../api';

type Status = 'loading' | 'authed' | 'guest';
interface AuthValue { status: Status; me: UserDTO | null; refresh: () => Promise<void>; signOut: () => Promise<void>; }

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<UserDTO | null>(null);

  const refresh = useCallback(async () => {
    try { const r = await getMe(); setMe(r.user); setStatus('authed'); }
    catch { setMe(null); setStatus('guest'); }
  }, []);
  const signOut = useCallback(async () => {
    await apiLogout().catch(() => undefined); setMe(null); setStatus('guest');
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return <Ctx.Provider value={{ status, me, refresh, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth вне AuthProvider');
  return v;
}
```

- [ ] **Step 3: `packages/admin/src/auth/ProtectedRoute.tsx`**

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function ProtectedRoute() {
  const { status } = useAuth();
  if (status === 'loading') return <div className="muted" style={{ padding: 24 }}>Загрузка…</div>;
  if (status === 'guest') return <Navigate to="/login" replace />;
  return <Outlet />;
}
```

- [ ] **Step 4: Verify** — `npm run type-check` зелёный (модули компилируются против shared DTO).

- [ ] **Step 5: Commit**

```bash
git add packages/admin/src/api.ts packages/admin/src/auth
git commit -m "feat(admin): API client + auth context + protected route"
```

### Task 3: UI-примитивы (Button, TextField)

**Files:**
- Create: `packages/admin/src/ui/Button.tsx` + `Button.module.scss`, `packages/admin/src/ui/TextField.tsx` + `TextField.module.scss`

**Interfaces:**
- Produces: `<Button variant="primary"|"ghost" ...>` (обёртка `<button>`), `<TextField label ... />` (label + `<input>` + error slot). Используются на страницах auth/settings.

- [ ] **Step 1: `Button.tsx` + `Button.module.scss`** — кнопка-пилюля; `primary` = фон `$accent`, белый текст, hover `$accent-hover`; `ghost` = прозрачная с бордером. Проброс `type`, `disabled`, `onClick`, `children`, `...rest` на нативный `<button>`.

```tsx
import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.scss';
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'ghost'; }
export function Button({ variant = 'primary', className, ...rest }: Props) {
  return <button className={`${styles.btn} ${styles[variant]} ${className ?? ''}`} {...rest} />;
}
```
```scss
@use '../styles/tokens' as *;
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; border-radius: 999px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.primary { background: $accent; color: #fff; }
.primary:hover:not(:disabled) { background: $accent-hover; }
.ghost { background: transparent; color: $text; border-color: $border; }
```

- [ ] **Step 2: `TextField.tsx` + `TextField.module.scss`** — `<label>` над `<input>`; проброс `value/onChange/type/placeholder/...`; опциональный `error` (красный текст под полем). Focus-ring цвета `$accent`.

```tsx
import type { InputHTMLAttributes } from 'react';
import styles from './TextField.module.scss';
interface Props extends InputHTMLAttributes<HTMLInputElement> { label?: string; error?: string; }
export function TextField({ label, error, className, id, ...rest }: Props) {
  return (
    <div className={styles.field}>
      {label && <label htmlFor={id} className={styles.label}>{label}</label>}
      <input id={id} className={`${styles.input} ${error ? styles.invalid : ''} ${className ?? ''}`} {...rest} />
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}
```
```scss
@use '../styles/tokens' as *;
.field { display: flex; flex-direction: column; gap: 6px; }
.label { font-size: 13px; color: $text-muted; }
.input { padding: 10px 12px; border: 1px solid $border; border-radius: $radius; font-size: 14px; }
.input:focus { outline: 2px solid $accent; outline-offset: 0; border-color: $accent; }
.invalid { border-color: #dc2626; }
.error { color: #dc2626; font-size: 12px; }
```

- [ ] **Step 3: Verify** — `npm run type-check` зелёный.

- [ ] **Step 4: Commit**

```bash
git add packages/admin/src/ui
git commit -m "feat(admin): Button and TextField ui primitives (scss modules)"
```

### Task 4: Страницы входа и регистрации

**Files:**
- Create: `packages/admin/src/pages/LoginPage.tsx` + `AuthPage.module.scss` (общий для login/register), `packages/admin/src/pages/RegisterPage.tsx`
- Modify: `packages/admin/src/main.tsx`

**Interfaces:**
- Consumes: `api.login`/`api.register`, `useAuth().refresh`, `Button`, `TextField`.
- Produces: `/login`, `/register` — центрированная карточка; на успех вызывают `refresh()` и переходят на `/`.

- [ ] **Step 1: `AuthPage.module.scss`** — центрированный контейнер (min-height 100vh, flex center), карточка `max-width: 380px`, лого Skribo (текст), заголовок, вертикальный стек полей, ссылка-переключатель login↔register, слот ошибки.

- [ ] **Step 2: `LoginPage.tsx`** — форма email+пароль; сабмит: `await login({email,password})` → `await refresh()` → `navigate('/')`; при ошибке показать текст (`err.message`, напр. `invalid_credentials`). Ссылка на `/register`.

```tsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { login } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import styles from './AuthPage.module.scss';

export function LoginPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await login({ email, password }); await refresh(); navigate('/'); }
    catch (err) { setError((err as Error).message === 'invalid_credentials' ? 'Неверный email или пароль' : 'Не удалось войти'); }
    finally { setBusy(false); }
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={onSubmit}>
        <div className={styles.brand}>Skribo</div>
        <h1 className={styles.title}>Вход</h1>
        <TextField id="email" label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <TextField id="password" label="Пароль" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <span className={styles.formError}>{error}</span>}
        <Button type="submit" disabled={busy}>{busy ? 'Вход…' : 'Войти'}</Button>
        <div className={styles.switch}>Нет аккаунта? <Link to="/register">Регистрация</Link></div>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: `RegisterPage.tsx`** — как login, но поля name (опц.)/email/пароль; `await register({email,password,name})` → `refresh()` → `/`; ошибки: `email_taken`→«Email уже занят», `invalid_input`→«Пароль от 8 символов». Ссылка на `/login`.

- [ ] **Step 4: Обновить `main.tsx`** — обернуть в `AuthProvider`; маршруты `/login`→`LoginPage`, `/register`→`RegisterPage` (публичные), остальное — под `ProtectedRoute` (пока internal-заглушка; шелл подключим в Task 5).

- [ ] **Step 5: Verify (браузер)** — поднять бэкенд (`docker compose up -d db`, `npm run dev:backend`) + `npm run dev:admin`; через Chrome DevTools MCP или вручную: открыть `http://localhost:5173/register`, зарегистрироваться → редирект на `/`; разлогиниться/зайти на `/login` → войти. Проверить консоль без ошибок. Остановить процессы. `npm run type-check` зелёный.

- [ ] **Step 6: Commit**

```bash
git add packages/admin/src/pages/LoginPage.tsx packages/admin/src/pages/RegisterPage.tsx packages/admin/src/pages/AuthPage.module.scss packages/admin/src/main.tsx
git commit -m "feat(admin): login and register pages"
```

### Task 5: App-shell (CabinetLayout) + маршруты

**Files:**
- Create: `packages/admin/src/layout/CabinetLayout.tsx` + `CabinetLayout.module.scss`, `packages/admin/src/pages/MeetingsPage.tsx` + `MeetingsPage.module.scss`
- Modify: `packages/admin/src/main.tsx`

**Interfaces:**
- Consumes: `useAuth()` (me, signOut), `Outlet`, `NavLink`.
- Produces: `CabinetLayout` (левый сайдбар + `<Outlet/>`); маршруты под `ProtectedRoute`→`CabinetLayout`: index (`MeetingsPage` заглушка), `/settings`.

- [ ] **Step 1: `CabinetLayout.tsx` + scss`** — сайдбар (ширина ~240px, белый, бордер справа): лого «Skribo» сверху; `NavLink` «Переговоры» (`/`) и «Настройки» (`/settings`) с active-стилем (акцентный фон/текст); внизу профиль (`me.name || me.email`) + кнопка «Выйти» (`signOut` → перейти `/login`). Справа — `<main>` с `<Outlet/>`. active-цвет — `$accent`.

- [ ] **Step 2: `MeetingsPage.tsx`** — заглушка: заголовок «Переговоры» + пустое состояние «Пока нет переговоров. Начните запись в расширении.» (реальный список — sub-plan 3).

- [ ] **Step 3: Обновить `main.tsx`** — финальная структура маршрутов:

```tsx
<AuthProvider>
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<CabinetLayout />}>
        <Route index element={<MeetingsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
</AuthProvider>
```
(Импортировать `Navigate`, `SettingsPage` из Task 6 — если Task 6 ещё не готов, временно заглушка; порядок задач: 5 перед 6, поэтому добавить импорт `SettingsPage` в Task 6.)

- [ ] **Step 4: Verify (браузер)** — с поднятыми бэкендом+admin: после входа виден шелл с сайдбаром; «Переговоры» показывает пустое состояние; «Выйти» уводит на `/login`; прямой заход на `/` без сессии → редирект `/login`. Консоль чистая. `npm run type-check` зелёный.

- [ ] **Step 5: Commit**

```bash
git add packages/admin/src/layout packages/admin/src/pages/MeetingsPage.tsx packages/admin/src/pages/MeetingsPage.module.scss packages/admin/src/main.tsx
git commit -m "feat(admin): cabinet app shell (sidebar layout) + meetings placeholder"
```

### Task 6: Настройки + персональный токен расширения

**Files:**
- Create: `packages/admin/src/pages/SettingsPage.tsx` + `SettingsPage.module.scss`
- Modify: `packages/admin/src/main.tsx` (импорт `SettingsPage`, если ещё заглушка)

**Interfaces:**
- Consumes: `useAuth().me`, `api.listTokens/createToken/deleteToken`, `Button`, `TextField`.
- Produces: `/settings` — профиль (email/имя, только чтение в MVP) + блок «Расширение»: список токенов (label/created), кнопка «Создать токен» (после создания показать сырой `token` один раз с кнопкой «Скопировать»), удаление токена.

- [ ] **Step 1: `SettingsPage.tsx`** — секция «Профиль»: показать `me.email`, `me.name`. Секция «Расширение»: `useEffect` грузит `listTokens()`; кнопка «Создать токен» → `createToken()` → показать вернувшийся `token` (моноширинный, кнопка «Скопировать» через `navigator.clipboard.writeText`) с подписью «Скопируйте сейчас — больше не покажем»; список существующих с кнопкой «Удалить» (`deleteToken(id)` → обновить список). Инструкция: «Вставьте токен в расширение Skribo, чтобы переговоры сохранялись в вашем аккаунте.»

- [ ] **Step 2: Обновить `main.tsx`** — убедиться, что `/settings` рендерит реальный `SettingsPage` (импорт).

- [ ] **Step 3: Verify (браузер)** — залогиненный: `/settings` показывает профиль; «Создать токен» → появляется 64-hex токен + «Скопировать» работает; после перезагрузки токен есть в списке БЕЗ сырого значения; «Удалить» убирает его; всё через реальный `/api/tokens`. Консоль чистая. `npm run type-check` зелёный.

- [ ] **Step 4: Commit**

```bash
git add packages/admin/src/pages/SettingsPage.tsx packages/admin/src/pages/SettingsPage.module.scss packages/admin/src/main.tsx
git commit -m "feat(admin): settings page with extension personal-token management"
```

### Task 7: Финальная проверка под-плана

**Files:** none (verification only)

- [ ] **Step 1:** `npm run type-check` (корень) зелёный; `npm run build --workspace=@livescribe/admin` собирается (`dist/` создан).
- [ ] **Step 2:** Полный браузерный smoke (бэкенд+БД+admin подняты): регистрация → шелл → создать токен в настройках → выйти → войти. Снять скриншоты login и шелла (Chrome DevTools MCP), приложить как доказательство. Остановить процессы.
- [ ] **Step 3:** Зафиксировать в `PROGRESS.md`/`backlog.md`: sub-plan 2 готов; следующий — sub-plan 3 (список переговоров).
- [ ] **Step 4: Commit** (docs).

---

## Self-Review

- **Spec coverage** (spec `2026-07-24-admin-cabinet-design.md`): auth email+пароль → Tasks 2,4; app-shell (сайдбар: Переговоры/Настройки/профиль) → Task 5; настройки + токен расширения → Task 6; стек React/Vite/RR7/Radix/`*.module.scss` + акцент Skribo → Tasks 1,3; список/карточка встречи → **не здесь** (sub-plans 3–4, только заглушка списка). Домен `app.skribo.ru`/деплой — deploy-time, вне плана (отмечено).
- **Placeholder scan:** код ключевых файлов приведён целиком; scss-детали заданы правилами + токенами; браузер-верификация с конкретными шагами.
- **Type consistency:** `AuthValue`/`useAuth`, `api` функции (`getMe`→`AuthResponse`, `login`/`register`→`AuthResponse`, `createToken`→`PersonalTokenDTO`), маршруты (`/login`,`/register`,`/`,`/settings`) согласованы между задачами; `UserDTO`/`PersonalTokenDTO` из shared.

## Вне плана (follow-up)
- Деплой кабинета на `app.skribo.ru` (A-запись + Caddy vhost + раздача `admin/dist` бэкендом/статикой) — deploy-time, отдельно.
- Реальный список переговоров (sub-plan 3), карточка встречи (sub-plan 4), Radix-обёртки под сложные компоненты — по мере надобности.
