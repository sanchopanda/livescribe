# Password reset (email) Implementation Plan (LS-12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** «Забыли пароль» в кабинете — запрос сброса по email, письмо со ссылкой-токеном, установка нового пароля.

**Architecture:** Prisma-модель `PasswordResetToken` (хеш токена, TTL 1ч, одноразовый); почтовый модуль `packages/backend/src/email/` (nodemailer, SMTP через env); эндпоинты `POST /api/auth/forgot` (всегда 200) + `POST /api/auth/reset`; страницы кабинета `/forgot` и `/reset`.

**Tech Stack:** Fastify 5 (ESM `.js`-импорты), Prisma + Postgres (локально :5433, поднят), nodemailer, vitest; admin — React 19 + RR7 + `*.module.scss`. Общие паттерны: `generateToken()/hashToken()` (auth/tokens.js), `hashPassword()` (auth/passwords.js), `TextField` (глазок).

Spec: `docs/superpowers/specs/2026-07-27-password-reset-design.md`.

## Global Constraints

- ESM: относительные импорты в бэке — с `.js`.
- Почта **опциональна**: без SMTP-конфига сервер работает, `forgot` всё равно `200`, письмо не уходит (лог-warning). SMTP НЕ добавлять в prod-assertion `index.ts`.
- **Без энумерации:** `POST /api/auth/forgot` всегда `200 {ok:true}` (кроме отсутствующего/пустого email → `400 invalid_request`).
- Reset-токен: хеш в БД (`hashToken`, SHA-256), TTL 1ч, одноразовый (`usedAt`). Пароль ≥ 8 символов.
- Русский UI-текст; английские идентификаторы/коды ошибок.
- Перед коммитом: `npm run type-check` (корень) зелёный; бэк-задачи — `npm run test --workspace=@livescribe/backend` зелёный; admin — `npm run build --workspace=@livescribe/admin`.
- Читать затрагиваемый файл перед правкой; следовать паттернам (`req<T>` в admin `api.ts`; страницы `LoginPage`/`RegisterPage` как шаблон; `TextField` для паролей).

---

### Task 1: Миграция `PasswordResetToken` + почтовый модуль

**Files:**
- Modify: `packages/backend/prisma/schema.prisma` (+ миграция)
- Modify: `packages/backend/package.json` (dep `nodemailer` + `@types/nodemailer`)
- Create: `packages/backend/src/email/config.ts`
- Create: `packages/backend/src/email/mailer.ts`
- Create: `packages/backend/src/email/mailer.test.ts`
- Modify: `packages/backend/.env.example`

**Interfaces:**
- Produces: `isEmailConfigured()`, `getSmtpConfig()`, `getAppUrl()` (config.ts); `sendMail`, `buildResetEmail(resetUrl)`, `sendPasswordResetEmail(to, resetUrl)` (mailer.ts); модель `PasswordResetToken`.

- [ ] **Step 1:** В `schema.prisma` добавить модель и обратную связь в `User`:
```prisma
model PasswordResetToken {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
  @@index([userId])
}
```
В модель `User` добавить строку: `passwordResetTokens PasswordResetToken[]`.

- [ ] **Step 2:** Установить зависимость и создать миграцию (локальный Postgres на :5433 поднят):
```bash
npm install nodemailer -w @livescribe/backend
npm install -D @types/nodemailer -w @livescribe/backend
npm run --workspace=@livescribe/backend exec -- prisma migrate dev --name password_reset_token
```
Ожидание: миграция создана в `packages/backend/prisma/migrations/`, Prisma Client перегенерён. (Если `npm run exec` недоступен — `cd packages/backend && npx prisma migrate dev --name password_reset_token`.)

- [ ] **Step 3:** `packages/backend/src/email/config.ts`:
```ts
export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}
export function getSmtpConfig() {
  return {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM,
  };
}
export function getAppUrl(): string {
  return process.env.APP_URL || 'https://app.skribo.ru';
}
```

- [ ] **Step 4:** `packages/backend/src/email/mailer.ts`:
```ts
import nodemailer, { type Transporter } from 'nodemailer';
import { isEmailConfigured, getSmtpConfig } from './config.js';

let transport: Transporter | null = null;
function getTransport(): Transporter | null {
  if (!isEmailConfigured()) return null;
  if (!transport) {
    const c = getSmtpConfig();
    transport = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: c.user && c.pass ? { user: c.user, pass: c.pass } : undefined,
    });
  }
  return transport;
}

export function buildResetEmail(resetUrl: string): { subject: string; html: string; text: string } {
  const subject = 'Сброс пароля — Skribo';
  const text = `Вы запросили сброс пароля в Skribo.\n\nПерейдите по ссылке, чтобы задать новый пароль (действует 1 час):\n${resetUrl}\n\nЕсли вы не запрашивали сброс — проигнорируйте это письмо.`;
  const html = `<p>Вы запросили сброс пароля в <b>Skribo</b>.</p>` +
    `<p><a href="${resetUrl}">Задать новый пароль</a> (ссылка действует 1 час).</p>` +
    `<p>Если вы не запрашивали сброс — проигнорируйте это письмо.</p>`;
  return { subject, html, text };
}

export async function sendMail(msg: { to: string; subject: string; html: string; text: string }): Promise<void> {
  const t = getTransport();
  if (!t) {
    console.warn('[email] SMTP not configured; skipping send to', msg.to);
    return;
  }
  await t.sendMail({ from: getSmtpConfig().from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await sendMail({ to, ...buildResetEmail(resetUrl) });
}
```

- [ ] **Step 5:** `packages/backend/src/email/mailer.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { isEmailConfigured } from './config.js';
import { buildResetEmail } from './mailer.js';

afterEach(() => { delete process.env.SMTP_HOST; delete process.env.SMTP_FROM; });

describe('isEmailConfigured', () => {
  it('false without host/from', () => { expect(isEmailConfigured()).toBe(false); });
  it('true with host + from', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'no-reply@skribo.ru';
    expect(isEmailConfigured()).toBe(true);
  });
});

describe('buildResetEmail', () => {
  it('embeds the reset url in html and text', () => {
    const url = 'https://app.skribo.ru/reset?token=abc123';
    const { subject, html, text } = buildResetEmail(url);
    expect(subject).toContain('Skribo');
    expect(html).toContain(url);
    expect(text).toContain(url);
  });
});
```

- [ ] **Step 6:** В `packages/backend/.env.example` добавить:
```
# SMTP (password reset) — optional; without it the server runs but no email is sent
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=Skribo <no-reply@skribo.ru>
APP_URL=https://app.skribo.ru
```

- [ ] **Step 7: Verify** — `npm run type-check` зелёный; `npm run test --workspace=@livescribe/backend` — новые тесты проходят; миграция присутствует в `prisma/migrations/`.

- [ ] **Step 8: Commit**
```bash
git add packages/backend/prisma packages/backend/package.json package-lock.json packages/backend/src/email packages/backend/.env.example
git commit -m "feat(backend): PasswordResetToken model + email (nodemailer/SMTP) module"
```

---

### Task 2: Эндпоинты forgot + reset

**Files:**
- Modify: `packages/backend/src/auth/routes.ts`

**Interfaces:**
- Consumes: `generateToken`/`hashToken` (tokens.js), `hashPassword` (passwords.js), `prisma`, `getAppUrl` (email/config.js), `sendPasswordResetEmail` (email/mailer.js), модель `PasswordResetToken`.
- Produces: `POST /api/auth/forgot`, `POST /api/auth/reset`.

- [ ] **Step 1:** В `routes.ts` добавить импорты (рядом с существующими):
```ts
import { generateToken, hashToken } from './tokens.js';
import { getAppUrl } from '../email/config.js';
import { sendPasswordResetEmail } from '../email/mailer.js';
```
(`hashPassword` уже импортирован; `prisma` уже импортирован.) И константа рядом с `registerAuthRoutes`:
```ts
const RESET_TTL_MS = 60 * 60 * 1000;
```

- [ ] **Step 2:** Внутри `registerAuthRoutes(server)` добавить `POST /api/auth/forgot` (всегда 200, без энумерации):
```ts
  server.post('/api/auth/forgot', async (req, reply) => {
    const { email } = (req.body ?? {}) as { email?: unknown };
    if (typeof email !== 'string' || !email.trim()) return reply.code(400).send({ error: 'invalid_request' });
    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (user) {
      const { raw, hash } = generateToken();
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      });
      const resetUrl = `${getAppUrl()}/reset?token=${raw}`;
      try {
        await sendPasswordResetEmail(user.email, resetUrl);
      } catch (err) {
        req.log.error({ err }, 'failed to send reset email');
      }
    }
    return { ok: true };
  });
```

- [ ] **Step 3:** Добавить `POST /api/auth/reset`:
```ts
  server.post('/api/auth/reset', async (req, reply) => {
    const { token, password } = (req.body ?? {}) as { token?: unknown; password?: unknown };
    if (typeof token !== 'string' || !token.trim()) return reply.code(400).send({ error: 'invalid_or_expired' });
    if (typeof password !== 'string' || password.length < 8) return reply.code(400).send({ error: 'weak_password' });

    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token.trim()) } });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      return reply.code(400).send({ error: 'invalid_or_expired' });
    }

    const newHash = await hashPassword(password);
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash: newHash } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    return { ok: true };
  });
```

- [ ] **Step 4: Verify** — `npm run type-check` зелёный; `npm run test --workspace=@livescribe/backend` зелёный (старые тесты не сломаны; новых юнитов на роуты не требуется — эндпоинты выверяются чтением + ручной проверкой при деплое).

- [ ] **Step 5: Commit**
```bash
git add packages/backend/src/auth/routes.ts
git commit -m "feat(backend): password forgot/reset endpoints (single-use token, 1h TTL)"
```

---

### Task 3: Кабинет — страницы «забыли пароль» и «сброс»

**Files:**
- Modify: `packages/admin/src/api.ts`
- Create: `packages/admin/src/pages/ForgotPasswordPage.tsx`
- Create: `packages/admin/src/pages/ResetPasswordPage.tsx`
- Modify: `packages/admin/src/main.tsx`
- Modify: `packages/admin/src/pages/LoginPage.tsx`

**Interfaces:**
- Consumes: эндпоинты forgot/reset; `req` helper; `TextField`; паттерн `LoginPage`.
- Produces: `forgotPassword`/`resetPassword` (api.ts); страницы + роуты `/forgot`, `/reset`; ссылка на `LoginPage`.

- [ ] **Step 1:** Прочитать `packages/admin/src/pages/LoginPage.tsx` + его `*.module.scss` + `packages/admin/src/ui/TextField.tsx` — новые страницы делать в ТОМ ЖЕ визуальном стиле (обёртка/заголовок/кнопка/сообщение об ошибке), переиспользуя `TextField` (у него уже есть глазок для `type="password"`) и общий auth-layout/классы, что и `LoginPage`.

- [ ] **Step 2:** В `packages/admin/src/api.ts` добавить:
```ts
export const forgotPassword = (email: string) =>
  req<{ ok: true }>('/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
export const resetPassword = (token: string, password: string) =>
  req<{ ok: true }>('/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
```

- [ ] **Step 3:** `ForgotPasswordPage.tsx` (`/forgot`) — форма с одним полем email (в стиле `LoginPage`), сабмит вызывает `forgotPassword(email)`; **при любом ответе** (успех) показать сообщение «Если аккаунт с таким email существует, мы отправили ссылку для сброса пароля»; поле/кнопка дизейблятся во время запроса; сетевую ошибку показать общим текстом. Ссылка «← Ко входу» на `/login` (через `Link`).

- [ ] **Step 4:** `ResetPasswordPage.tsx` (`/reset`) — `const [params] = useSearchParams(); const token = params.get('token')`. Если токена нет → показать ошибку «Ссылка недействительна» + `Link` на `/forgot`. Иначе форма: два `TextField type="password"` (новый пароль + повтор). Клиентская валидация: длина ≥ 8 и совпадение (иначе показать сообщение, не слать). Сабмит → `resetPassword(token, password)`:
  - успех → `navigate('/login')` (React Router `useNavigate`); передать флаг/сообщение об успехе (напр. через `navigate('/login', { state: { reset: true } })`, а `LoginPage` покажет «Пароль изменён, войдите» если `location.state?.reset`) — либо проще показать успех прямо на странице + `Link` на `/login`.
  - ошибка `weak_password` → «Пароль должен быть не короче 8 символов»; `invalid_or_expired` → «Ссылка недействительна или истекла» + `Link` «Запросить снова» на `/forgot`; иначе общий текст.

- [ ] **Step 5:** В `packages/admin/src/main.tsx` — импортировать новые страницы и добавить публичные роуты рядом с `/login` (вне `ProtectedRoute`):
```tsx
<Route path="/forgot" element={<ForgotPasswordPage />} />
<Route path="/reset" element={<ResetPasswordPage />} />
```

- [ ] **Step 6:** В `packages/admin/src/pages/LoginPage.tsx` — добавить ссылку «Забыли пароль?» (`Link` на `/forgot`) рядом с формой/кнопкой, в существующем стиле.

- [ ] **Step 7: Verify** — `npm run type-check` (корень) зелёный; `npm run build --workspace=@livescribe/admin` собирается. Живая проверка (реальное письмо → сброс) требует SMTP-конфига и запущенного стека — за пользователем/деплоем; в отчёте указать явно. Опц. локально: без SMTP `forgot` возвращает 200 (страница показывает подтверждение), reset с левым токеном → «недействительна».

- [ ] **Step 8: Commit**
```bash
git add packages/admin/src/api.ts packages/admin/src/pages/ForgotPasswordPage.tsx packages/admin/src/pages/ResetPasswordPage.tsx packages/admin/src/main.tsx packages/admin/src/pages/LoginPage.tsx
git commit -m "feat(admin): forgot/reset password pages + login link"
```

---

## Self-Review

- **Spec coverage:** модель + email-модуль → Task 1; forgot (всегда 200) + reset (одноразовый/TTL/пароль≥8) → Task 2; страницы `/forgot`+`/reset` + ссылка + api → Task 3. Тесты чистых функций → Task 1 Step 5. Env → Task 1 Step 6.
- **Placeholder scan:** бэк-код приведён полностью; admin-страницы заданы поведением + опорой на `LoginPage`/`TextField` (существующий паттерн, читается в Step 1).
- **Type consistency:** `generateToken() → {raw,hash}` ↔ создание токена (hash в БД, raw в ссылке); `hashToken(token)` ↔ поиск при reset; `hashPassword` await ДО `$transaction`; `forgotPassword`/`resetPassword` в api.ts ↔ тела эндпоинтов; `PasswordResetToken` поля (`tokenHash`/`expiresAt`/`usedAt`) согласованы между схемой, forgot и reset.

## Вне плана (follow-up)
- Верификация email при регистрации; rate-limit на forgot/reset; смена email.
- Деплой: SMTP-креды в prod-`.env` + `prisma migrate deploy` (обновить deploy-скилл); ADR о почтовом провайдере.
