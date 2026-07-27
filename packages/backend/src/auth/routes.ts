import type { FastifyInstance, FastifyReply } from 'fastify';
import type { RegisterRequest, LoginRequest, AuthResponse } from '@skribo/shared';
import { prisma } from '../db/prisma.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { signJwt, generateToken, hashToken } from './tokens.js';
import { requireUser } from './guard.js';
import { getAppUrl } from '../email/config.js';
import { sendPasswordResetEmail } from '../email/mailer.js';

const RESET_TTL_MS = 60 * 60 * 1000;

function setSession(reply: FastifyReply, userId: string) {
  reply.setCookie('skribo_session', signJwt(userId), {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production',
  });
}

// helper: ensure the user has exactly one 'extension'-labeled token, return a fresh raw token
async function getOrRotateExtensionToken(userId: string): Promise<string> {
  await prisma.personalToken.deleteMany({ where: { userId, label: 'extension' } });
  const { raw, hash } = generateToken();
  await prisma.personalToken.create({ data: { userId, tokenHash: hash, label: 'extension' } });
  return raw;
}

export function registerAuthRoutes(server: FastifyInstance) {
  server.post('/api/auth/register', async (req, reply) => {
    const { email, password, name } = req.body as RegisterRequest;
    if (typeof email !== 'string' || !email || typeof password !== 'string' || !password) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (password.length < 8) return reply.code(400).send({ error: 'invalid_input' });
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return reply.code(409).send({ error: 'email_taken' });
    try {
      const user = await prisma.user.create({
        data: { email: normalizedEmail, passwordHash: await hashPassword(password), name: name ?? null },
      });
      setSession(reply, user.id);
      return { user: { id: user.id, email: user.email, name: user.name } } as AuthResponse;
    } catch (err: any) {
      if (err?.code === 'P2002') return reply.code(409).send({ error: 'email_taken' });
      throw err;
    }
  });

  server.post('/api/auth/login', async (req, reply) => {
    const { email, password } = req.body as LoginRequest;
    if (typeof email !== 'string' || !email || typeof password !== 'string' || !password) {
      return reply.code(400).send({ error: 'invalid_input' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
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

  server.post('/api/auth/reset', async (req, reply) => {
    const { token, password } = (req.body ?? {}) as { token?: unknown; password?: unknown };
    if (typeof token !== 'string' || !token.trim()) return reply.code(400).send({ error: 'invalid_or_expired' });
    if (typeof password !== 'string' || password.length < 8) return reply.code(400).send({ error: 'weak_password' });

    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token.trim()) } });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      return reply.code(400).send({ error: 'invalid_or_expired' });
    }

    const newHash = await hashPassword(password);
    // Atomic single-use: only the transaction that flips usedAt (conditional on it
    // still being null) may change the password — guards against concurrent double-use.
    const applied = await prisma.$transaction(async (tx) => {
      const marked = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (marked.count === 0) return false;
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash: newHash } });
      return true;
    });
    if (!applied) return reply.code(400).send({ error: 'invalid_or_expired' });
    return { ok: true };
  });
}
