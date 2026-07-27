import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/prisma.js';
import { verifyJwt, hashToken } from './tokens.js';

export async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<{ id: string } | null> {
  const token = (req.cookies as Record<string, string | undefined>)?.skribo_session;
  const payload = token ? verifyJwt(token) : null;
  if (!payload) {
    reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return { id: payload.userId };
}

export async function resolveUserByToken(rawToken: string | undefined | null): Promise<{ id: string } | null> {
  const raw = rawToken?.trim();
  if (!raw) return null;
  const tok = await prisma.personalToken.findFirst({ where: { tokenHash: hashToken(raw) } });
  return tok ? { id: tok.userId } : null;
}
