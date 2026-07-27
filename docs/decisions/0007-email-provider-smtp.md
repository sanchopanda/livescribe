# ADR-0007: Email — SMTP через nodemailer (абстракция)

Дата: 2026-07-27
Статус: принято

## Контекст

Для восстановления пароля (LS-12) нужна отправка транзакционных писем. Варианты: прямой SDK
транзакционного API (Resend/SendGrid/Postmark, в основном US-роутинг); RU-провайдер
(Yandex 360 / Mail.ru for business); или SMTP-абстракция.

## Решение

Отправляем письма через **`nodemailer` по SMTP**; провайдер задаётся через env
(`SMTP_HOST/PORT/SECURE/USER/PASS/FROM`, `APP_URL`). Конкретный провайдер (почта Beget для
skribo.ru, Yandex, любой SMTP) выбирается при деплое — код не меняется.

## Обоснование

- Одна интеграция для любого SMTP-провайдера; смена — через env, без вендор-лока (как OpenRouter,
  ADR-0006).
- Можно нацелить на RU-резидентную почту (Beget/Yandex) для доставляемости в RU-ящики и
  152-ФЗ-посадки, оставаясь свободными сменить.
- Фича gated конфигом: без SMTP сервер работает, `POST /api/auth/forgot` всё равно `200`
  (без энумерации), письмо просто не уходит (лог-warning).

## Последствия

- Нужны SMTP-креды в prod-`.env` (deploy-скилл). Без них сброс пароля не доедет до пользователя.
- Доставляемость зависит от выбранного провайдера/домена (SPF/DKIM/DMARC на skribo.ru — при
  подключении реального провайдера).
- Reset-токен: хеш в БД, TTL 1ч, одноразовый (атомарно). Rate-limit на forgot/reset — follow-up.

## Ссылки

- Спека/план: `docs/superpowers/specs/2026-07-27-password-reset-design.md`,
  `docs/superpowers/plans/2026-07-27-password-reset.md`.
- Код: `packages/backend/src/email/` (`config.ts`, `mailer.ts`), `auth/routes.ts`
  (`/api/auth/forgot`, `/api/auth/reset`), модель `PasswordResetToken`.
