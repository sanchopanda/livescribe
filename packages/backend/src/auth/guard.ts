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
