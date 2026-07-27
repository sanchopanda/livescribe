import type { FastifyInstance } from 'fastify';
import { resolveUserByToken } from '../auth/guard.js';
import { isLlmConfigured } from '../llm/config.js';
import { summarizeLive } from '../llm/live-summary.js';

const MAX_TRANSCRIPT = 16000;

export function registerLlmRoutes(server: FastifyInstance) {
  server.post('/api/live-summary', async (req, reply) => {
    const auth = req.headers.authorization;
    const raw = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    const user = await resolveUserByToken(raw);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    if (!isLlmConfigured()) return reply.code(503).send({ error: 'analysis_unavailable' });

    const body = (req.body ?? {}) as { transcript?: unknown };
    const trimmed = typeof body.transcript === 'string' ? body.transcript.trim() : '';
    if (!trimmed) return reply.code(400).send({ error: 'no_transcript' });
    const transcript = trimmed.length > MAX_TRANSCRIPT ? trimmed.slice(-MAX_TRANSCRIPT) : trimmed;

    try {
      const result = await summarizeLive(transcript);
      return { bullets: result.bullets };
    } catch (err) {
      req.log.error({ err }, 'live summary failed');
      return reply.code(502).send({ error: 'analysis_failed' });
    }
  });
}
