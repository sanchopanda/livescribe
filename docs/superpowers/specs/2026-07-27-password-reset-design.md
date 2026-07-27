# Дизайн: сброс пароля по email (LS-12)

Дата: 2026-07-27
Статус: согласован

## Контекст и цель

Auth в кабинете — только register/login (email+пароль, JWT-cookie). Нет восстановления пароля и
почтовой инфраструктуры. Цель LS-12: «забыли пароль» — юзер запрашивает сброс по email, получает
письмо со ссылкой-токеном, задаёт новый пароль. Почта — через SMTP (nodemailer, провайдер через
env). **Только сброс пароля** (верификация email при регистрации — вне объёма).

## Ключевые решения

1. **SMTP через `nodemailer`**, провайдер задаётся env (`SMTP_HOST/PORT/USER/PASS/FROM`) — можно
   нацелить на Beget-почту skribo.ru / Yandex / любой. Абстракция, без вендор-лока.
2. **Reset-токен** — случайный (`generateToken()` из `auth/tokens.ts`), хранится **хешем**
   (`hashToken`, SHA-256), срок жизни **1 час**, **одноразовый** (`usedAt`).
3. **Без энумерации:** `POST /api/auth/forgot` всегда отвечает `200`, есть юзер или нет.
4. Почта **опциональна** (как LLM-ключ): без SMTP-конфига forgot всё равно `200`, письмо не
   уходит (лог-warning). НЕ добавляем SMTP в prod-assertion `index.ts`.
5. Вне объёма: верификация email при регистрации, rate-limit, смена email.

## Схема (миграция Prisma)

Новая модель:
```prisma
model PasswordResetToken {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())
  @@index([userId])
}
```
+ обратное поле `passwordResetTokens PasswordResetToken[]` в `User`. Миграция —
`prisma migrate dev --name password_reset_token` (локальный Postgres на :5433 поднят).

## Архитектура

### Бэкенд — почтовый модуль `packages/backend/src/email/`

- **`config.ts`** — env: `SMTP_HOST`, `SMTP_PORT` (число, дефолт 587), `SMTP_USER`, `SMTP_PASS`,
  `SMTP_FROM` (напр. `Skribo <no-reply@skribo.ru>`), `SMTP_SECURE` (bool, дефолт false),
  `APP_URL` (дефолт `https://app.skribo.ru`). `isEmailConfigured()` = есть HOST+FROM (+ порт).
- **`mailer.ts`** — ленивый `nodemailer.createTransport` из config; `sendMail({to,subject,html,text})`.
  Если `!isEmailConfigured()` — не шлём, лог-warning, резолв без ошибки. `buildResetEmail(resetUrl)`
  → `{subject, html, text}` (RU). `sendPasswordResetEmail(to, resetUrl)`.

### Бэкенд — эндпоинты (`packages/backend/src/auth/routes.ts`)

- **`POST /api/auth/forgot`** `{ email }`:
  - нормализовать email; найти юзера. Если есть: `generateToken()` → создать `PasswordResetToken`
    (hash, `expiresAt = now + 1ч`), `resetUrl = ${APP_URL}/reset?token=<raw>`,
    `sendPasswordResetEmail` (best-effort, ошибку отправки логировать, не падать).
  - **Всегда** `200 { ok: true }`.
- **`POST /api/auth/reset`** `{ token, password }`:
  - `password` строка, длина ≥ 8, иначе `400 weak_password`.
  - `hashToken(token)` → найти `PasswordResetToken` где `tokenHash` совпал, `usedAt = null`,
    `expiresAt > now`. Нет/использован/истёк → `400 invalid_or_expired`.
  - Транзакция: `user.passwordHash = hashPassword(password)`; `token.usedAt = now`. `200 { ok: true }`.
  - Опц.: инвалидация прочих активных reset-токенов юзера (или полагаться на одноразовость).

### Кабинет (`packages/admin`)

- **`api.ts`**: `forgotPassword(email)` → `POST /auth/forgot`; `resetPassword(token, password)` →
  `POST /auth/reset`.
- **`ForgotPasswordPage.tsx`** (`/forgot`): поле email → сабмит → всегда сообщение «Если аккаунт с
  таким email существует, мы отправили ссылку для сброса». Ссылка «← Ко входу».
- **`ResetPasswordPage.tsx`** (`/reset`): читает `token` из query (`useSearchParams`); поля новый
  пароль + повтор (через `TextField`, глазок уже есть); валидация (совпадение, ≥8); сабмит →
  успех → `navigate('/login')` c сообщением; `invalid_or_expired` → ошибка + ссылка на `/forgot`;
  нет токена в URL → сразу ошибка.
- **`LoginPage.tsx`**: ссылка «Забыли пароль?» → `/forgot`.
- **`main.tsx`**: публичные роуты `/forgot`, `/reset` (рядом с `/login`, вне `ProtectedRoute`).

## Обработка ошибок

| Ситуация | Бэкенд | UI |
|---|---|---|
| forgot (любой email) | `200 {ok}` | «Если аккаунт есть — отправили ссылку» |
| reset: слабый пароль | `400 weak_password` | «Пароль должен быть не короче 8 символов» |
| reset: токен невалиден/истёк/использован | `400 invalid_or_expired` | «Ссылка недействительна или истекла» + «Запросить снова» |
| нет SMTP-конфига | forgot всё равно `200` | без изменений (письмо не ушло) |

## Тестирование

- **Юнит (vitest):** `isEmailConfigured` (набор env), `buildResetEmail` (в html/text есть resetUrl),
  политика пароля (≥8). Мок `nodemailer`/транспорта для `sendMail` — опц.
- **Ручная (при деплое с реальным SMTP):** forgot → письмо → ссылка → reset → вход с новым паролем;
  повторное использование токена/истёкший → ошибка. `type-check` + сборки бэка и админки зелёные;
  миграция применяется.

## Критерии готовности

- «Забыли пароль?» в кабинете → email → письмо со ссылкой (при настроенном SMTP) → страница сброса
  → новый пароль → вход работает.
- forgot не раскрывает существование email; reset-токен одноразовый и истекает; слабый пароль
  отклоняется.
- Без SMTP-конфига сервер работает, forgot возвращает 200 (письмо не уходит).
- Миграция применена; `type-check` + сборки + юнит-тесты зелёные.

## Вне объёма (follow-up)

- Верификация email при регистрации; rate-limit на forgot/reset; смена email; ADR о выборе
  почтового провайдера; добавить SMTP-креды в prod-`.env` (deploy-скилл).
