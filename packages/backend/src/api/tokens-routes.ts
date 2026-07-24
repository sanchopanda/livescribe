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
