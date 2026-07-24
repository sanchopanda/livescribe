# Admin Foundation (БД + авторизация + API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать бэкенду Postgres-персистентность, авторизацию (email+пароль, JWT-cookie) и API, чтобы транскрипты аутентифицированной сессии сохранялись как встречи и читались кабинетом.

**Architecture:** В `packages/backend` добавляем Prisma/Postgres, `@fastify/cookie`, auth-роуты и meetings-роуты под префиксом `/api`. WS-`start` принимает персональный токен → создаёт `Meeting`, финальные транскрипты пишутся в `TranscriptSegment`. Доменные типы/DTO — в `packages/shared`.

**Tech Stack:** Fastify 5, Prisma + PostgreSQL, `@fastify/cookie`, `jsonwebtoken`, `bcryptjs`, Vitest. Первый под-план спеки `docs/superpowers/specs/2026-07-24-admin-cabinet-design.md`.

## Global Constraints

- Пароли — `bcryptjs` (чистый JS, без нативной сборки); сессия — JWT в **httpOnly-cookie** (`skribo_session`).
- Все новые HTTP-роуты — под префиксом **`/api`**.
- STT — только Deepgram (ADR-0001); не трогаем провайдеры.
- Английские доменные идентификаторы в коде; русский — в UI/доках.
- Секреты (`DATABASE_URL`, `JWT_SECRET`) — только в `.env`, не в git.
- Персональный токен хранится как **хэш** (`tokenHash`), сырой токен показывается один раз.
- Без валидного токена WS-`start` работает как сейчас (аноним, без сохранения) — не ломать текущий поток.
- `npm run type-check` зелёный перед коммитом.

## File Structure

- Create `packages/backend/prisma/schema.prisma` — модель данных.
- Create `packages/backend/src/db/prisma.ts` — синглтон PrismaClient.
- Create `packages/backend/src/auth/passwords.ts` — hash/verify (bcryptjs).
- Create `packages/backend/src/auth/tokens.ts` — генерация/хэш персонального токена, JWT sign/verify.
- Create `packages/backend/src/auth/routes.ts` — `/api/auth/*`.
- Create `packages/backend/src/auth/guard.ts` — резолв текущего пользователя из cookie.
- Create `packages/backend/src/api/tokens-routes.ts` — `/api/tokens*`.
- Create `packages/backend/src/api/meetings-routes.ts` — `/api/meetings*`.
- Create tests: `packages/backend/src/auth/passwords.test.ts`, `tokens.test.ts`.
- Modify `packages/backend/src/server.ts` — регистрация cookie + роутов.
- Modify `packages/backend/src/websocket/handler.ts` — токен→user→Meeting, сохранение сегментов, финализация на stop.
- Modify `packages/backend/src/websocket/session.ts` — хранить `userId`/`meetingId` в сессии.
- Modify `packages/shared/src/*` — доменные типы + DTO; `token?` в start-сообщении.
- Modify `packages/backend/package.json` — deps + `test` (vitest).
- Create `docker-compose.yml` (корень) — локальный Postgres для разработки.
- Modify `packages/backend/.env.example` — `DATABASE_URL`, `JWT_SECRET`.

---

### Task 1: Postgres (docker) + Prisma схема + миграция

**Files:**
- Create: `docker-compose.yml`, `packages/backend/prisma/schema.prisma`, `packages/backend/src/db/prisma.ts`
- Modify: `packages/backend/package.json`, `packages/backend/.env.example`

**Interfaces:**
- Produces: `prisma` (singleton `PrismaClient` из `src/db/prisma.ts`); модели `User`, `Meeting`, `TranscriptSegment`, `Analysis`, `PersonalToken`.

- [ ] **Step 1: Добавить deps + скрипты в `packages/backend/package.json`**

В `dependencies`: `"@prisma/client": "^6.0.0"`, `"@fastify/cookie": "^11.0.0"`, `"jsonwebtoken": "^9.0.2"`, `"bcryptjs": "^2.4.3"`.
В `devDependencies`: `"prisma": "^6.0.0"`, `"vitest": "^3.2.0"`, `"@types/jsonwebtoken": "^9.0.0"`, `"@types/bcryptjs": "^2.4.6"`.
В `scripts` добавить: `"test": "vitest run"`, `"db:generate": "prisma generate"`, `"db:migrate": "prisma migrate dev"`.

- [ ] **Step 2: `docker-compose.yml` (корень) — локальный Postgres**

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: skribo
      POSTGRES_PASSWORD: skribo
      POSTGRES_DB: skribo
    ports:
      - "5432:5432"
    volumes:
      - skribo_pgdata:/var/lib/postgresql/data
volumes:
  skribo_pgdata:
```

- [ ] **Step 3: `packages/backend/.env.example` — добавить строки**

```
DATABASE_URL=postgresql://skribo:skribo@localhost:5432/skribo?schema=public
JWT_SECRET=change-me-dev-secret
```
(В реальный `.env` вписать те же значения для dev.)

- [ ] **Step 4: `packages/backend/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String          @id @default(cuid())
  email        String          @unique
  passwordHash String
  name         String?
  createdAt    DateTime        @default(now())
  meetings     Meeting[]
  tokens       PersonalToken[]
}

model Meeting {
  id                String             @id @default(cuid())
  userId            String
  user              User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  platform          String?
  title             String?
  audioMode         String?
  startedAt         DateTime           @default(now())
  endedAt           DateTime?
  durationSec       Int?
  participantsCount Int?
  createdAt         DateTime           @default(now())
  segments          TranscriptSegment[]
  analysis          Analysis?
  @@index([userId, startedAt])
}

model TranscriptSegment {
  id         String  @id @default(cuid())
  meetingId  String
  meeting    Meeting @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  speaker    String?
  text       String
  tsMs       Int
  isFinal    Boolean @default(true)
  confidence Float?
  @@index([meetingId, tsMs])
}

model Analysis {
  id          String   @id @default(cuid())
  meetingId   String   @unique
  meeting     Meeting  @relation(fields: [meetingId], references: [id], onDelete: Cascade)
  summary     String?
  actionItems Json?
  createdAt   DateTime @default(now())
}

model PersonalToken {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique
  label      String?
  createdAt  DateTime  @default(now())
  lastUsedAt DateTime?
}
```

- [ ] **Step 5: `packages/backend/src/db/prisma.ts`**

```ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
```

- [ ] **Step 6: Установить, поднять БД, сгенерировать клиент, миграция**

```bash
npm install
docker compose up -d db
cd packages/backend && npx prisma migrate dev --name init
```
Expected: миграция создаёт таблицы, `prisma generate` проходит.

- [ ] **Step 7: Verify** — `cd packages/backend && npx prisma migrate status` показывает применённую миграцию; `npm run type-check` из корня — зелёный.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml packages/backend/prisma packages/backend/src/db packages/backend/package.json packages/backend/.env.example package-lock.json
git commit -m "feat(backend): add Postgres + Prisma schema (User/Meeting/Segment/Analysis/Token)"
```

### Task 2: Доменные типы и DTO в shared

**Files:**
- Create: `packages/shared/src/domain.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/websocket-protocol.ts`

**Interfaces:**
- Produces: типы `UserDTO`, `MeetingDTO`, `MeetingDetailDTO`, `TranscriptSegmentDTO`, `AnalysisDTO`, `AuthResponse`, `LoginRequest`, `RegisterRequest`, `PersonalTokenDTO`; поле `token?: string` в start-сообщении.

- [ ] **Step 1: `packages/shared/src/domain.ts`**

```ts
export interface UserDTO { id: string; email: string; name: string | null; }
export interface AuthResponse { user: UserDTO; }
export interface LoginRequest { email: string; password: string; }
export interface RegisterRequest { email: string; password: string; name?: string; }

export interface TranscriptSegmentDTO {
  id: string; speaker: string | null; text: string; tsMs: number; confidence: number | null;
}
export interface AnalysisDTO { summary: string | null; actionItems: unknown | null; }
export interface MeetingDTO {
  id: string; platform: string | null; title: string | null; audioMode: string | null;
  startedAt: string; endedAt: string | null; durationSec: number | null; participantsCount: number | null;
}
export interface MeetingDetailDTO extends MeetingDTO {
  segments: TranscriptSegmentDTO[]; analysis: AnalysisDTO | null;
}
export interface PersonalTokenDTO {
  id: string; label: string | null; createdAt: string; lastUsedAt: string | null; token?: string;
}
```

- [ ] **Step 2: экспортнуть из `packages/shared/src/index.ts`** — добавить `export * from './domain.js';`

- [ ] **Step 3: В `packages/shared/src/websocket-protocol.ts`** — в тип start-сообщения (`ClientMessage` start-вариант) добавить необязательное поле `token?: string;`.

- [ ] **Step 4: Verify** — `npm run build --workspace=@livescribe/shared` проходит, `dist/domain.d.ts` создан.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): domain DTOs and start-message token field"
```

### Task 3: Auth-логика (пароли, токены, JWT) — TDD

**Files:**
- Create: `packages/backend/src/auth/passwords.ts`, `packages/backend/src/auth/tokens.ts`
- Test: `packages/backend/src/auth/passwords.test.ts`, `packages/backend/src/auth/tokens.test.ts`

**Interfaces:**
- Produces: `hashPassword(pw: string): Promise<string>`, `verifyPassword(pw: string, hash: string): Promise<boolean>`; `generateToken(): { raw: string; hash: string }`, `hashToken(raw: string): string`, `signJwt(userId: string): string`, `verifyJwt(token: string): { userId: string } | null`.

- [ ] **Step 1: Падающий тест `passwords.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './passwords.js';

describe('passwords', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('s3cret!');
    expect(hash).not.toBe('s3cret!');
    expect(await verifyPassword('s3cret!', hash)).toBe(true);
    expect(await verifyPassword('nope', hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить — падает** `cd packages/backend && npx vitest run src/auth/passwords.test.ts` → FAIL (модуль не найден).

- [ ] **Step 3: `packages/backend/src/auth/passwords.ts`**

```ts
import bcrypt from 'bcryptjs';

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}
```

- [ ] **Step 4: Тест `tokens.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { generateToken, hashToken, signJwt, verifyJwt } from './tokens.js';

describe('tokens', () => {
  it('generates a token whose hash matches hashToken(raw)', () => {
    const { raw, hash } = generateToken();
    expect(raw).toHaveLength(64);
    expect(hashToken(raw)).toBe(hash);
  });
  it('signs and verifies a JWT round-trip', () => {
    const jwt = signJwt('user_123');
    expect(verifyJwt(jwt)?.userId).toBe('user_123');
    expect(verifyJwt('garbage')).toBeNull();
  });
});
```

- [ ] **Step 5: `packages/backend/src/auth/tokens.ts`**

```ts
import { randomBytes, createHash } from 'crypto';
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-secret';

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex'); // 64 hex chars
  return { raw, hash: hashToken(raw) };
}
export function signJwt(userId: string): string {
  return jwt.sign({ userId }, SECRET, { expiresIn: '30d' });
}
export function verifyJwt(token: string): { userId: string } | null {
  try {
    const p = jwt.verify(token, SECRET) as { userId: string };
    return { userId: p.userId };
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Запустить тесты — зелёные** `cd packages/backend && npx vitest run src/auth` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/auth/passwords.ts packages/backend/src/auth/tokens.ts packages/backend/src/auth/passwords.test.ts packages/backend/src/auth/tokens.test.ts
git commit -m "feat(backend): auth primitives (bcrypt passwords, token hashing, JWT) with tests"
```

### Task 4: Auth-роуты и guard

**Files:**
- Create: `packages/backend/src/auth/guard.ts`, `packages/backend/src/auth/routes.ts`
- Modify: `packages/backend/src/server.ts`

**Interfaces:**
- Consumes: `prisma`, `hashPassword`/`verifyPassword`, `signJwt`/`verifyJwt`.
- Produces: `requireUser(req, reply): Promise<{ id: string } | null>` (guard); плагин `registerAuthRoutes(server)`; cookie `skribo_session`.

- [ ] **Step 1: `packages/backend/src/auth/guard.ts`**

```ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyJwt } from './tokens.js';

export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<{ id: string } | null> {
  const token = (req.cookies as Record<string, string | undefined>)?.skribo_session;
  const payload = token ? verifyJwt(token) : null;
  if (!payload) {
    reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return { id: payload.userId };
}
```

- [ ] **Step 2: `packages/backend/src/auth/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { RegisterRequest, LoginRequest, AuthResponse } from '@livescribe/shared';
import { prisma } from '../db/prisma.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { signJwt } from './tokens.js';
import { requireUser } from './guard.js';

function setSession(reply: any, userId: string) {
  reply.setCookie('skribo_session', signJwt(userId), {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production',
  });
}

export function registerAuthRoutes(server: FastifyInstance) {
  server.post('/api/auth/register', async (req, reply) => {
    const { email, password, name } = req.body as RegisterRequest;
    if (!email || !password || password.length < 8) return reply.code(400).send({ error: 'invalid_input' });
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return reply.code(409).send({ error: 'email_taken' });
    const user = await prisma.user.create({ data: { email, passwordHash: await hashPassword(password), name: name ?? null } });
    setSession(reply, user.id);
    return { user: { id: user.id, email: user.email, name: user.name } } as AuthResponse;
  });

  server.post('/api/auth/login', async (req, reply) => {
    const { email, password } = req.body as LoginRequest;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) return reply.code(401).send({ error: 'invalid_credentials' });
    setSession(reply, user.id);
    return { user: { id: user.id, email: user.email, name: user.name } } as AuthResponse;
  });

  server.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie('skribo_session', { path: '/' });
    return { ok: true };
  });

  server.get('/api/auth/me', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const user = await prisma.user.findUnique({ where: { id: u.id } });
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    return { user: { id: user.id, email: user.email, name: user.name } } as AuthResponse;
  });
}
```

- [ ] **Step 3: Зарегистрировать в `server.ts`** — после `await server.register(cors, …)` добавить:

```ts
import cookie from '@fastify/cookie';
import { registerAuthRoutes } from './auth/routes.js';
// ...
await server.register(cookie);
registerAuthRoutes(server);
```
(CORS для кабинета: заменить `origin: true` на `origin: [process.env.WEB_ORIGIN || 'http://localhost:5173', 'https://app.skribo.ru'], credentials: true`.)

- [ ] **Step 4: Verify** — поднять (`npm run dev:backend`), затем:

```bash
curl -s -c /tmp/cj -X POST localhost:3001/api/auth/register -H 'content-type: application/json' -d '{"email":"a@b.co","password":"password1"}'   # {"user":{...}}
curl -s -b /tmp/cj localhost:3001/api/auth/me                                                                                                   # {"user":{...}}
curl -s -X POST localhost:3001/api/auth/login -H 'content-type: application/json' -d '{"email":"a@b.co","password":"wrong"}' -o /dev/null -w '%{http_code}\n'  # 401
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/auth/guard.ts packages/backend/src/auth/routes.ts packages/backend/src/server.ts
git commit -m "feat(backend): email+password auth routes with JWT cookie session"
```

### Task 5: Персональные токены (`/api/tokens`)

**Files:**
- Create: `packages/backend/src/api/tokens-routes.ts`
- Modify: `packages/backend/src/server.ts`

**Interfaces:**
- Consumes: `prisma`, `requireUser`, `generateToken`, `hashToken`.
- Produces: `registerTokenRoutes(server)`; `POST /api/tokens` (возвращает сырой `token` один раз), `GET /api/tokens`, `DELETE /api/tokens/:id`.

- [ ] **Step 1: `packages/backend/src/api/tokens-routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { PersonalTokenDTO } from '@livescribe/shared';
import { prisma } from '../db/prisma.js';
import { requireUser } from '../auth/guard.js';
import { generateToken } from '../auth/tokens.js';

export function registerTokenRoutes(server: FastifyInstance) {
  server.post('/api/tokens', async (req, reply) => {
    const u = await requireUser(req, reply); if (!u) return;
    const { label } = (req.body ?? {}) as { label?: string };
    const { raw, hash } = generateToken();
    const t = await prisma.personalToken.create({ data: { userId: u.id, tokenHash: hash, label: label ?? null } });
    return { id: t.id, label: t.label, createdAt: t.createdAt.toISOString(), lastUsedAt: null, token: raw } as PersonalTokenDTO;
  });

  server.get('/api/tokens', async (req, reply) => {
    const u = await requireUser(req, reply); if (!u) return;
    const list = await prisma.personalToken.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } });
    return list.map((t) => ({ id: t.id, label: t.label, createdAt: t.createdAt.toISOString(), lastUsedAt: t.lastUsedAt?.toISOString() ?? null } as PersonalTokenDTO));
  });

  server.delete('/api/tokens/:id', async (req, reply) => {
    const u = await requireUser(req, reply); if (!u) return;
    const { id } = req.params as { id: string };
    await prisma.personalToken.deleteMany({ where: { id, userId: u.id } });
    return { ok: true };
  });
}
```

- [ ] **Step 2: Зарегистрировать в `server.ts`** — `import { registerTokenRoutes } from './api/tokens-routes.js';` и `registerTokenRoutes(server);`.

- [ ] **Step 3: Verify** — с cookie из Task 4: `curl -s -b /tmp/cj -X POST localhost:3001/api/tokens -H 'content-type: application/json' -d '{"label":"my-ext"}'` возвращает `token` (64 hex); `GET /api/tokens` — без поля token.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/api/tokens-routes.ts packages/backend/src/server.ts
git commit -m "feat(backend): personal token endpoints for extension linking"
```

### Task 6: Привязка WS-сессии к пользователю и сохранение транскриптов

**Files:**
- Modify: `packages/backend/src/websocket/session.ts`, `packages/backend/src/websocket/handler.ts`

**Interfaces:**
- Consumes: `prisma`, `hashToken`.
- Produces: при `start` с валидным `token` — запись `Meeting` (id хранится в сессии); каждый финальный транскрипт → `TranscriptSegment`; при `stop`/закрытии — `endedAt`+`durationSec`.

- [ ] **Step 1: В `session.ts`** — в объект сессии добавить поля `userId?: string; meetingId?: string; startedAtMs?: number;` (в интерфейс сессии и при создании — по умолчанию `undefined`).

- [ ] **Step 2: В `handler.ts`, ветка `case 'start'`** — сразу после чтения `audioMode` добавить резолв пользователя и создание встречи:

```ts
// resolve user by personal token and open a Meeting
let meetingId: string | undefined;
let meetingUserId: string | undefined;
const rawToken = (message as any).token as string | undefined;
if (rawToken) {
  const { hashToken } = await import('../auth/tokens.js');
  const { prisma } = await import('../db/prisma.js');
  const tok = await prisma.personalToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (tok) {
    meetingUserId = tok.userId;
    const meeting = await prisma.meeting.create({
      data: {
        userId: tok.userId,
        platform: (message as any).platform ?? null,
        audioMode: audioMode ?? null,
        title: null,
      },
    });
    meetingId = meeting.id;
    await prisma.personalToken.update({ where: { id: tok.id }, data: { lastUsedAt: new Date() } });
  }
}
```
И при создании сессии прокинуть `meetingId`/`meetingUserId`/`startedAtMs: Date.now()` в сессию (расширить сигнатуру `sessionManager.createSession` необязательным аргументом `meta`, либо присвоить полям после создания).

- [ ] **Step 3: В `onResult`-колбэке** (там же в `start`) — сохранять финальные сегменты:

```ts
const onResult = (result: any) => {
  const session = sessionId ? sessionManager.getSession(sessionId) : undefined;
  const resolvedSpeaker = session?.speaker ?? undefined;
  sendTranscript(result, resolvedSpeaker);
  if (result.isFinal && session?.meetingId && result.text?.trim()) {
    import('../db/prisma.js').then(({ prisma }) =>
      prisma.transcriptSegment.create({
        data: {
          meetingId: session.meetingId!,
          speaker: resolvedSpeaker ?? null,
          text: result.text.trim(),
          tsMs: session.startedAtMs ? Date.now() - session.startedAtMs : 0,
          confidence: typeof result.confidence === 'number' ? result.confidence : null,
        },
      }).catch(() => {}),
    );
  }
};
```

- [ ] **Step 4: Финализация встречи при `stop`/закрытии** — в ветке `case 'stop'` и в обработчике `connection.on('close')` добавить:

```ts
const s = sessionId ? sessionManager.getSession(sessionId) : undefined;
if (s?.meetingId && s.startedAtMs) {
  const { prisma } = await import('../db/prisma.js');
  await prisma.meeting.update({
    where: { id: s.meetingId },
    data: { endedAt: new Date(), durationSec: Math.round((Date.now() - s.startedAtMs) / 1000) },
  }).catch(() => {});
}
```
(В `close`-хендлере, если он не async — обернуть в самовызывающийся async или `.then`.)

- [ ] **Step 5: Verify (интеграционно, вручную)** — с dev-БД: получить токен (Task 5), затем через `wscat`/скрипт открыть `ws://localhost:3001/ws`, отправить `{"type":"start","language":"ru-RU","platform":"meet","token":"<raw>"}`, потом `{"type":"audio",...}` (или пропустить), затем `{"type":"stop","sessionId":"..."}`; проверить в БД: `docker compose exec db psql -U skribo -d skribo -c 'select id,userId,platform,durationSec from "Meeting";'` — есть строка. Без токена — строки нет (аноним не ломается).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/websocket/session.ts packages/backend/src/websocket/handler.ts
git commit -m "feat(backend): persist authenticated sessions as meetings + transcript segments"
```

### Task 7: Meetings read API (`/api/meetings`)

**Files:**
- Create: `packages/backend/src/api/meetings-routes.ts`
- Modify: `packages/backend/src/server.ts`

**Interfaces:**
- Consumes: `prisma`, `requireUser`.
- Produces: `registerMeetingRoutes(server)`; `GET /api/meetings?q=&sort=` → `MeetingDTO[]`; `GET /api/meetings/:id` → `MeetingDetailDTO`.

- [ ] **Step 1: `packages/backend/src/api/meetings-routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { MeetingDTO, MeetingDetailDTO } from '@livescribe/shared';
import { prisma } from '../db/prisma.js';
import { requireUser } from '../auth/guard.js';

export function registerMeetingRoutes(server: FastifyInstance) {
  server.get('/api/meetings', async (req, reply) => {
    const u = await requireUser(req, reply); if (!u) return;
    const { q, sort } = req.query as { q?: string; sort?: string };
    const meetings = await prisma.meeting.findMany({
      where: { userId: u.id, ...(q ? { title: { contains: q, mode: 'insensitive' } } : {}) },
      orderBy: { startedAt: sort === 'oldest' ? 'asc' : 'desc' },
    });
    return meetings.map((m): MeetingDTO => ({
      id: m.id, platform: m.platform, title: m.title, audioMode: m.audioMode,
      startedAt: m.startedAt.toISOString(), endedAt: m.endedAt?.toISOString() ?? null,
      durationSec: m.durationSec, participantsCount: m.participantsCount,
    }));
  });

  server.get('/api/meetings/:id', async (req, reply) => {
    const u = await requireUser(req, reply); if (!u) return;
    const { id } = req.params as { id: string };
    const m = await prisma.meeting.findFirst({
      where: { id, userId: u.id },
      include: { segments: { orderBy: { tsMs: 'asc' } }, analysis: true },
    });
    if (!m) return reply.code(404).send({ error: 'not_found' });
    const detail: MeetingDetailDTO = {
      id: m.id, platform: m.platform, title: m.title, audioMode: m.audioMode,
      startedAt: m.startedAt.toISOString(), endedAt: m.endedAt?.toISOString() ?? null,
      durationSec: m.durationSec, participantsCount: m.participantsCount,
      segments: m.segments.map((s) => ({ id: s.id, speaker: s.speaker, text: s.text, tsMs: s.tsMs, confidence: s.confidence })),
      analysis: m.analysis ? { summary: m.analysis.summary, actionItems: m.analysis.actionItems } : null,
    };
    return detail;
  });
}
```

- [ ] **Step 2: Зарегистрировать в `server.ts`** — `import { registerMeetingRoutes } from './api/meetings-routes.js';` и `registerMeetingRoutes(server);`.

- [ ] **Step 3: Verify** — с cookie: `curl -s -b /tmp/cj localhost:3001/api/meetings` → массив (после Task 6 — с созданной встречей); `GET /api/meetings/<id>` → детали с `segments`. Чужой/несуществующий id → 401/404.

- [ ] **Step 4: Финальная проверка под-плана** — `npm run type-check` зелёный; `npm run test --workspace=@livescribe/backend` зелёный.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/api/meetings-routes.ts packages/backend/src/server.ts
git commit -m "feat(backend): meetings read API (list + detail)"
```

---

## Self-Review

- **Spec coverage:** модель данных → Task 1; DTO/типы → Task 2; auth email+пароль/JWT-cookie → Tasks 3–4; персональные токены → Task 5; привязка расширения + персистентность (LS-07) → Task 6; чтение встреч для кабинета → Task 7. Домен `app.skribo.ru`, SPA, экраны — это под-планы 2–4 (не здесь). Пробелов в рамках фундамента нет.
- **Placeholder scan:** нет TBD/«handle errors» без кода; каждый шаг с реальным кодом/командой и коммитом.
- **Type consistency:** `hashToken`/`generateToken`/`signJwt`/`verifyJwt`, cookie `skribo_session`, DTO-имена (`MeetingDTO`, `MeetingDetailDTO`, `PersonalTokenDTO`) согласованы между задачами; поле `token?` на start-сообщении определено в Task 2 и используется в Task 6.

## Замечание по деплою (после под-плана)

На сервере Beget Postgres пока не установлен. Перед прод-использованием: поставить Postgres на VM (или Beget «Облачные БД»), задать `DATABASE_URL`/`JWT_SECRET`/`WEB_ORIGIN` в серверном `.env`, `prisma migrate deploy`. Это отражаем в `deploy`-скилле при выкатке.
