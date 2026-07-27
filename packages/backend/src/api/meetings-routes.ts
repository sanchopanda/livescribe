import type { FastifyInstance } from 'fastify';
import type { MeetingDTO, MeetingDetailDTO, ActionItem } from '@livescribe/shared';
import { prisma } from '../db/prisma.js';
import { requireUser } from '../auth/guard.js';
import { isLlmConfigured } from '../llm/config.js';
import { analyzeMeeting } from '../llm/analysis.js';

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
      analysis: m.analysis
        ? {
            summary: m.analysis.summary,
            actionItems: m.analysis.actionItems as ActionItem[] | null,
            createdAt: m.analysis.createdAt.toISOString(),
          }
        : null,
    };
    return detail;
  });

  server.post('/api/meetings/:id/analysis', async (req, reply) => {
    const u = await requireUser(req, reply); if (!u) return;
    if (!isLlmConfigured()) return reply.code(503).send({ error: 'analysis_unavailable' });
    const { id } = req.params as { id: string };
    const m = await prisma.meeting.findFirst({
      where: { id, userId: u.id },
      include: { segments: { where: { isFinal: true }, orderBy: { tsMs: 'asc' } } },
    });
    if (!m) return reply.code(404).send({ error: 'not_found' });
    if (m.segments.length === 0) return reply.code(400).send({ error: 'no_transcript' });

    let result;
    try {
      result = await analyzeMeeting(m.segments.map((s) => ({ speaker: s.speaker, text: s.text })));
    } catch (err) {
      req.log.error({ err }, 'analysis failed');
      return reply.code(502).send({ error: 'analysis_failed' });
    }

    const saved = await prisma.analysis.upsert({
      where: { meetingId: m.id },
      create: { meetingId: m.id, summary: result.summary, actionItems: result.actionItems as unknown as object },
      update: { summary: result.summary, actionItems: result.actionItems as unknown as object, createdAt: new Date() },
    });
    return {
      summary: saved.summary,
      actionItems: saved.actionItems as ActionItem[] | null,
      createdAt: saved.createdAt.toISOString(),
    };
  });
}
