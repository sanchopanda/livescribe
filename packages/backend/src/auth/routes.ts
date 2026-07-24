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
