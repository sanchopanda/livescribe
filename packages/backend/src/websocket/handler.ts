import type { FastifyInstance } from 'fastify';
import type { ClientMessage, ServerMessage } from '@skribo/shared';
import { AUTH_INVALID_TOKEN } from '@skribo/shared';
import { SessionManager } from './session.js';
import { createSTTProvider } from '../stt/index.js';
import type { STTProviderType } from '../stt/index.js';
import type { STTStatus } from '../stt/types.js';
import { aggregateSttStatus } from '../stt/aggregate-status.js';
import { prisma } from '../db/prisma.js';
import { hashToken } from '../auth/tokens.js';
import { appendSpeakerChange, pickSpeakerAt, segmentSpokenAt } from './speaker-timeline.js';

const sessionManager = new SessionManager();
let wsConnectionSequence = 0;

type SessionLike = ReturnType<SessionManager['getSession']>;

/**
 * Speaker for a transcript segment in mixed capture. Streaming results lag the audio by a
 * second or three, so the segment's own stream offset decides who was speaking — not the
 * speaker who happens to be active when the result arrives. Falls back to the last known
 * speaker when the segment carries no timing (or arrived before any speaker update).
 *
 * Mapping the offset onto wall-clock assumes the audio arrives continuously and in real time,
 * which holds for mixed capture. Per-track capture is VAD-gated and does not need this: there
 * the speaker travels with the track and arrives on `result.speaker`.
 *
 * Exported for tests.
 */
export function resolveSpeakerForSegment(session: SessionLike, result: any): string | undefined {
  if (typeof result?.speaker === 'string' && result.speaker) return result.speaker;
  if (!session) return undefined;

  const spokenAt = segmentSpokenAt(session.sttStreamStartedAtMs, result?.startSec);
  if (spokenAt !== undefined) {
    const match = pickSpeakerAt(session.speakerTimeline, spokenAt);
    if (match) return match.speaker ?? undefined;
  }

  return session.speaker ?? undefined;
}

export interface TranscriptSegmentRecord {
  meetingId: string;
  speaker: string | null;
  text: string;
  tsMs: number;
  confidence: number | null;
}

/**
 * The row a transcript result should become, or `null` when it must not be stored.
 *
 * Only finals are kept (partials are rewritten as the utterance unfolds), and only for a session
 * tied to a Meeting — an anonymous session has nothing to attach a segment to. Pure on purpose:
 * both capture modes decide this the same way, and the decision is what tests can pin down.
 *
 * Exported for tests.
 */
export function buildTranscriptSegmentRecord(
  session: SessionLike,
  result: { isFinal?: boolean; text?: string; confidence?: number } | null | undefined,
  speaker: string | undefined,
  nowMs: number,
): TranscriptSegmentRecord | null {
  if (!result?.isFinal) return null;
  if (!session?.meetingId) return null;

  const text = typeof result.text === 'string' ? result.text.trim() : '';
  if (!text) return null;

  return {
    meetingId: session.meetingId,
    speaker: speaker ?? null,
    text,
    tsMs: session.startedAtMs ? nowMs - session.startedAtMs : 0,
    confidence: typeof result.confidence === 'number' ? result.confidence : null,
  };
}

/**
 * Whether a client-supplied `resumeMeetingId` may continue into this meeting.
 *
 * The id comes off the wire, so ownership decides — a token must never be able to append
 * transcript to somebody else's meeting.
 *
 * Exported for tests.
 */
export function canResumeMeeting(
  meeting: { id: string; userId: string } | null | undefined,
  tokenUserId: string,
): boolean {
  if (!meeting) return false;
  return meeting.userId === tokenUserId;
}

// Get STT provider type - read from env at runtime, not at module load
// This ensures dotenv.config() has been called first
function getSTTProviderType(): STTProviderType {
  return (process.env.STT_PROVIDER as STTProviderType) || 'deepgram';
}

export function registerWebSocketHandler(server: FastifyInstance) {
  server.get('/ws', { websocket: true }, (connection, _req) => {
    const connectionId = ++wsConnectionSequence;
    const conn = `ws#${connectionId}`;
    let sessionId: string | null = null;
    let activeLanguage: 'ru-RU' | 'en-US' = 'ru-RU';
    let activeProviderType: STTProviderType = getSTTProviderType();
    type ParticipantProviderEntry = {
      provider: any;
      speaker: string | null;
      ready: Promise<void>;
    };

    const participantProviders = new Map<string, ParticipantProviderEntry>();
    const participantChunkCount = new Map<string, number>();

    // LS-04: в mixed-режиме на всю сессию один провайдер (ключ 'session'), в
    // per-track — по одному на участника (ключ participantId). Статусы
    // приходят из нескольких независимых источников, поэтому клиенту шлём не
    // их напрямую, а agregateSttStatus() — и только когда агрегат меняется,
    // иначе реконнект одного из N участников заливал бы клиента дребезгом.
    const sttStatuses = new Map<string, STTStatus>();
    let lastAggregatedSttStatus: STTStatus | null = null;

    const sendSttStatusIfChanged = () => {
      const aggregate = aggregateSttStatus(Array.from(sttStatuses.values()));
      if (aggregate === lastAggregatedSttStatus) return;
      lastAggregatedSttStatus = aggregate;

      const message: ServerMessage = { type: 'stt_status', state: aggregate };
      connection.send(JSON.stringify(message));
      server.log.info({ conn, sessionId, state: aggregate }, 'STT status changed');
    };

    server.log.info({ conn }, 'WebSocket client connected');

    const sendTranscript = (result: any, speaker?: string) => {
      const transcriptMessage: ServerMessage = result.isFinal
        ? {
            type: 'final',
            text: result.text,
            timestamp: Date.now(),
            confidence: result.confidence ?? 0,
            speaker,
          }
        : {
            type: 'partial',
            text: result.text,
            timestamp: Date.now(),
            confidence: result.confidence,
            speaker,
          };

      connection.send(JSON.stringify(transcriptMessage));

      if (result?.text) {
        server.log.info(
          {
            conn,
            sessionId,
            isFinal: Boolean(result.isFinal),
            textLength: String(result.text).length,
            speaker: speaker ?? null,
          },
          'Transcript sent to client',
        );
      }
    };

    /**
     * Store a final transcript segment. Every capture mode goes through here: mixed feeds the
     * session-level STT stream, per-track feeds one stream per participant, and both must land
     * in the Meeting the cabinet reads.
     */
    const persistFinalSegment = (result: any, speaker?: string) => {
      const session = sessionId ? sessionManager.getSession(sessionId) : undefined;
      const record = buildTranscriptSegmentRecord(session, result, speaker, Date.now());
      if (!record) return;

      prisma.transcriptSegment.create({ data: record }).catch((err: Error) =>
        server.log.warn(
          { conn, sessionId, error: err.message },
          'Failed to persist transcript segment',
        ),
      );
    };

    const normalizeSpeakerLabel = (value: string | null | undefined): string | undefined => {
      if (typeof value !== 'string') return undefined;
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : undefined;
    };

    const formatParticipantFallback = (participantId: string): string => {
      const normalizedId = participantId.replace(/^participant_/i, '').trim();
      if (!normalizedId) {
        return 'Participant';
      }

      const shortId =
        normalizedId.length > 18
          ? `${normalizedId.slice(0, 8)}…${normalizedId.slice(-6)}`
          : normalizedId;

      return `Participant ${shortId}`;
    };

    const destroyParticipantProviders = async () => {
      for (const [, entry] of participantProviders) {
        try {
          await entry.provider.finalize();
        } catch {
          // ignore finalize errors
        }

        try {
          await entry.provider.destroy();
        } catch {
          // ignore destroy errors
        }
      }

      participantProviders.clear();
      // Тот же teardown обслуживает и mixed-режим (перезапуск сессии,
      // 'stop', закрытие сокета) — статус session-провайдера тоже должен
      // исчезнуть, а не тянуться дребезгом в следующую сессию.
      sttStatuses.clear();
      lastAggregatedSttStatus = null;
    };

    /**
     * Провайдер участника, чья `initialize()` не смогла завершиться (`ready`
     * отклонился), убирается из карты — но у него уже есть живая подписка
     * `onStatusChange()` (LS-04): без явного `destroy()` он продолжал бы
     * писать статусы в общий `sttStatuses` уже после того, как перестал
     * существовать с точки зрения остального кода — осиротевший провайдер,
     * дребезжащий в агрегат вечно.
     */
    const destroyOrphanedParticipant = async (participantId: string, provider: any) => {
      participantProviders.delete(participantId);
      try {
        await provider.destroy();
      } catch {
        // ignore destroy errors — provider is being discarded anyway
      }
      sttStatuses.delete(participantId);
      sendSttStatusIfChanged();
    };

    // If the session was tied to a persisted Meeting (i.e. a valid token was
    // presented on 'start'), stamp it with an end time + duration. No-op for
    // anonymous sessions (no meetingId).
    const finalizeMeeting = async (sid: string) => {
      const session = sessionManager.getSession(sid);
      if (!session?.meetingId) return;

      await prisma.meeting
        .update({
          where: { id: session.meetingId },
          data: {
            endedAt: new Date(),
            durationSec: session.startedAtMs
              ? Math.round((Date.now() - session.startedAtMs) / 1000)
              : null,
          },
        })
        .catch((err: Error) => {
          server.log.warn(
            { conn, sessionId: sid, error: err.message },
            'Failed to finalize meeting',
          );
        });
    };

    // server.log.info('WebSocket client connected');

    connection.on('message', async (data: Buffer) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());

        switch (message.type) {
          case 'start': {
            // A second 'start' on the same connection without an intervening
            // 'stop' must not leave the previous session's Meeting unfinalized
            // or orphan its segments. Tear it down first, mirroring 'stop'.
            if (sessionId) {
              await destroyParticipantProviders();
              await finalizeMeeting(sessionId);
              await sessionManager.destroySession(sessionId);
              sessionId = null;
            }

            const language = message.language || 'ru-RU';
            const audioMode = (message as any).audioMode || null;
            activeLanguage = language;
            activeProviderType = getSTTProviderType();
            await destroyParticipantProviders();
            participantChunkCount.clear();

            server.log.info(
              { conn, language: activeLanguage, provider: activeProviderType, platform: (message as any).platform ?? null, audioMode },
              'Start message received',
            );

            // Resolve the personal token (if any) to a user and open a Meeting to
            // persist this session's transcript. No token (or an invalid/unknown
            // token) falls back to the pre-existing anonymous, non-persisted flow.
            const rawToken = message.token;
            const resumeMeetingId = (message as any).resumeMeetingId as string | undefined;
            let startedAtMs = Date.now();
            let meetingId: string | undefined;
            let meetingUserId: string | undefined;
            if (rawToken) {
              try {
                const tok = await prisma.personalToken.findUnique({
                  where: { tokenHash: hashToken(rawToken) },
                });
                if (tok) {
                  meetingUserId = tok.userId;

                  // A reconnect continues the meeting it was cut off from. Without this, a
                  // socket that drops every minute shreds one call into a row of stubs.
                  const resumable = resumeMeetingId
                    ? await prisma.meeting.findUnique({ where: { id: resumeMeetingId } })
                    : null;

                  if (canResumeMeeting(resumable, tok.userId)) {
                    meetingId = resumable!.id;
                    // Keep the original start as the clock: segment offsets and the meeting's
                    // duration must stay continuous across the gap.
                    startedAtMs = resumable!.startedAt.getTime();
                    await prisma.meeting
                      .update({ where: { id: meetingId }, data: { endedAt: null } })
                      .catch(() => {});
                    server.log.info(
                      { conn, meetingId, userId: meetingUserId },
                      'Resumed meeting after reconnect',
                    );
                  } else {
                    if (resumeMeetingId) {
                      server.log.warn(
                        { conn, resumeMeetingId, userId: meetingUserId },
                        'Refused to resume meeting; opening a new one',
                      );
                    }
                    const meeting = await prisma.meeting.create({
                      data: {
                        userId: tok.userId,
                        platform: (message as any).platform ?? null,
                        audioMode: audioMode ?? null,
                      },
                    });
                    meetingId = meeting.id;
                    server.log.info(
                      { conn, meetingId, userId: meetingUserId },
                      'Meeting created for authenticated session',
                    );
                  }
                  prisma.personalToken
                    .update({ where: { id: tok.id }, data: { lastUsedAt: new Date() } })
                    .catch(() => {});
                } else {
                  // A token arrived but matches nothing — most often this device's token was
                  // revoked by a sign-in elsewhere. Keep transcribing (cutting a live call dead
                  // would be worse) but say so: silently degrading to an unsaved session is how
                  // a user talks for an hour and finds the cabinet empty.
                  server.log.warn(
                    { conn, platform: (message as any).platform ?? null, audioMode },
                    'Session token not recognised; continuing without persistence',
                  );
                  const authError: ServerMessage = {
                    type: 'error',
                    code: AUTH_INVALID_TOKEN,
                    message:
                      'Токен этого устройства больше не действителен — войдите в Skribo заново. ' +
                      'Расшифровка продолжится, но не сохранится в кабинет.',
                  };
                  connection.send(JSON.stringify(authError));
                }
              } catch (err) {
                // DB hiccup or lookup failure: behave exactly like the anonymous
                // path rather than failing the WS session.
                server.log.warn(
                  { conn, error: (err as Error).message },
                  'Failed to resolve token for session; continuing without persistence',
                );
              }
            } else {
              server.log.warn(
                { conn, platform: (message as any).platform ?? null, audioMode },
                'Session start carried no token; transcript will not reach the cabinet',
              );
            }

            // Create STT provider (optional - audio will still be saved even if STT fails)
            let sttProvider: any = null;
            try {
              const providerType = activeProviderType;
              // server.log.info(`Using STT provider: ${providerType} (from env: ${process.env.STT_PROVIDER || 'not set'})`);
              sttProvider = createSTTProvider(providerType);
              sttProvider.onStatusChange?.((status: STTStatus) => {
                sttStatuses.set('session', status);
                sendSttStatusIfChanged();
              });

              // Create callback for real-time transcriptions (for streaming providers like Deepgram)
              const onResult = (result: any) => {
                const session = sessionId ? sessionManager.getSession(sessionId) : undefined;
                const resolvedSpeaker = resolveSpeakerForSegment(session, result);

                sendTranscript(result, resolvedSpeaker);
                // server.log.debug(`Transcription (${result.isFinal ? 'final' : 'partial'}): ${result.text}`);

                persistFinalSegment(result, resolvedSpeaker);
              };
              
              await sttProvider.initialize(language, onResult);
              server.log.info(
                { conn, provider: providerType, language },
                'Session STT provider initialized',
              );
            } catch {
              // server.log.error(`STT provider initialization failed (audio will still be saved): ${(err as Error).message}`);
              // server.log.error(err, 'STT initialization error details');
              // Set sttProvider to null to ensure it's not used
              sttProvider = null;
              // Continue without STT - audio will still be saved to files
              // Send warning to client
              const warningResponse: ServerMessage = {
                type: 'error',
                code: 'STT_UNAVAILABLE',
                message: 'STT not available. Audio will be saved but not transcribed.',
              };
              connection.send(JSON.stringify(warningResponse));
              server.log.warn({ conn, provider: activeProviderType }, 'Session STT unavailable');
              // Continue anyway - create session without STT provider
            }

            // Create session with STT provider
            sessionId = sessionManager.createSession(connection, sttProvider, language, {
              userId: meetingUserId,
              meetingId,
              startedAtMs,
            });
            server.log.info({ conn, sessionId, language, meetingId }, 'Session started');

            const response: ServerMessage = {
              type: 'status',
              status: 'connected',
              sessionId,
              meetingId,
            };
            connection.send(JSON.stringify(response));
            break;
          }

          case 'audio': {
            if (!sessionId) {
              // server.log.warn('Received audio chunk without active session');
              return;
            }

            const session = sessionManager.getSession(sessionId);
            if (!session) {
              // server.log.warn('Session not found');
              return;
            }

            // Decode base64 audio chunk
            const audioBuffer = Buffer.from(message.chunk, 'base64');
            const participantId = (message as any).participantId as string | undefined;
            const participantSpeaker = (message as any).speaker as string | null | undefined;

            if (participantId) {
              let participantEntry = participantProviders.get(participantId);
              const normalizedParticipantSpeaker = normalizeSpeakerLabel(participantSpeaker);

              if (!participantEntry) {
                const participantProvider = createSTTProvider(activeProviderType);
                participantProvider.onStatusChange?.((status: STTStatus) => {
                  sttStatuses.set(participantId, status);
                  sendSttStatusIfChanged();
                });
                const ready = participantProvider.initialize(activeLanguage, (result: any) => {
                  const resolvedSpeaker = participantEntry?.speaker ?? formatParticipantFallback(participantId);
                  sendTranscript(result, resolvedSpeaker || undefined);
                  persistFinalSegment(result, resolvedSpeaker || undefined);
                });

                participantEntry = {
                  provider: participantProvider,
                  speaker: normalizedParticipantSpeaker ?? null,
                  ready,
                };

                participantProviders.set(participantId, participantEntry);

                server.log.info(
                  {
                    conn,
                    sessionId,
                    participantId,
                    speaker: participantSpeaker ?? null,
                    provider: activeProviderType,
                  },
                  'Participant STT provider created',
                );

                try {
                  await participantEntry.ready;
                } catch (err) {
                  await destroyOrphanedParticipant(participantId, participantProvider);
                  throw err;
                }
              } else if (normalizedParticipantSpeaker) {
                participantEntry.speaker = normalizedParticipantSpeaker;
              }

              try {
                await participantEntry.ready;
              } catch (err) {
                await destroyOrphanedParticipant(participantId, participantEntry.provider);
                throw err;
              }

              const format = (message as any).format;
              const count = (participantChunkCount.get(participantId) ?? 0) + 1;
              participantChunkCount.set(participantId, count);
              if (count === 1 || count % 50 === 0) {
                server.log.info(
                  {
                    conn,
                    sessionId,
                    participantId,
                    speaker: participantEntry.speaker,
                    chunkCount: count,
                    bytes: audioBuffer.byteLength,
                    format: format ?? null,
                  },
                  'Participant audio received',
                );
              }

              const sttResult = await participantEntry.provider.processAudio(audioBuffer, format);

              if (sttResult && sttResult.text) {
                const resolvedSpeaker = participantEntry.speaker ?? formatParticipantFallback(participantId);
                sendTranscript(sttResult, resolvedSpeaker || undefined);
              } else if (count === 1 || count % 100 === 0) {
                server.log.info(
                  { conn, sessionId, participantId, chunkCount: count },
                  'No transcript from participant chunk yet',
                );
              }
              return;
            }

            if (!session.sttProvider) {
              // server.log.warn('Session STT provider not found');
              server.log.warn({ conn, sessionId }, 'Session STT provider missing');
              return;
            }
            // server.log.debug(
            //   `Received audio chunk: ${audioBuffer.byteLength} bytes, session: ${sessionId}`
            // );

            // Store audio chunk for saving to file
            sessionManager.addAudioChunk(sessionId, audioBuffer);

            // Origin for Deepgram's segment offsets: the first chunk that reached the stream.
            if (session.sttStreamStartedAtMs === undefined) {
              session.sttStreamStartedAtMs = Date.now();
            }

            // Process audio through STT (if available and initialized)
            if (session.sttProvider) {
              try {
                // Pass format information if available
                const format = (message as any).format; // 'pcm' or 'ogg-opus'
                const sttResult = await session.sttProvider.processAudio(audioBuffer, format);
              
              if (sttResult && sttResult.text) {
                const segmentSpeaker = resolveSpeakerForSegment(session, sttResult);
                // Send transcription to client
                 const transcriptMessage: ServerMessage = sttResult.isFinal
                   ? {
                       type: 'final',
                       text: sttResult.text,
                       timestamp: Date.now(),
                       confidence: sttResult.confidence ?? 0,
                       speaker: segmentSpeaker,
                     }
                   : {
                       type: 'partial',
                       text: sttResult.text,
                       timestamp: Date.now(),
                       confidence: sttResult.confidence,
                       speaker: segmentSpeaker,
                     };

                connection.send(JSON.stringify(transcriptMessage));
                server.log.info(
                  {
                    conn,
                    sessionId,
                    isFinal: sttResult.isFinal,
                    textLength: sttResult.text.length,
                    speaker: segmentSpeaker ?? null,
                  },
                  'Session transcript sent',
                );
                // server.log.debug(`Transcription (${sttResult.isFinal ? 'final' : 'partial'}): ${sttResult.text}`);
              }
            } catch (err) {
                // Log error but don't fail - STT might not be available
                const errorMsg = (err as Error).message;
                if (!errorMsg.includes('not supported') && !errorMsg.includes('compatibility')) {
                  server.log.warn({ conn, sessionId, error: errorMsg }, 'Session STT processing error');
                } else {
                  server.log.warn({ conn, sessionId, error: errorMsg }, 'Session STT not available');
                }
                // Don't fail the connection, audio will still be saved
              }
            }

            break;
          }

          case 'speaker': {
            if (!sessionId) {
              // server.log.warn('Received speaker update without active session');
              return;
            }

            const session = sessionManager.getSession(sessionId);
            if (!session) {
              // server.log.warn('Received speaker update for missing session');
              return;
            }

            session.speaker = message.speaker ?? null;
            // Timestamped on arrival: WebSocket lag is tens of milliseconds, so no clock
            // synchronisation with the client is needed.
            appendSpeakerChange(session.speakerTimeline, {
              at: Date.now(),
              speaker: session.speaker,
              participantId: (message as any).participantId,
            });
            server.log.info({ conn, sessionId, speaker: session.speaker }, 'Speaker update received');
            break;
          }

          case 'stop': {
            if (sessionId) {
              await destroyParticipantProviders();
              await finalizeMeeting(sessionId);
              await sessionManager.destroySession(sessionId);
              // server.log.info(`Session stopped: ${sessionId}`);

              const response: ServerMessage = {
                type: 'status',
                status: 'idle',
              };
              connection.send(JSON.stringify(response));
              server.log.info({ conn, sessionId }, 'Session stopped');
              sessionId = null;
            }
            break;
          }

          default:
            // server.log.warn(`Unknown message type: ${(message as any).type}`);
        }
      } catch (err) {
        // server.log.error(`Error processing WebSocket message: ${(err as Error).message}`);
        server.log.warn({ conn, error: (err as Error).message }, 'Failed to process WebSocket message');

        const errorResponse: ServerMessage = {
          type: 'error',
          code: 'PROCESSING_ERROR',
          message: 'Failed to process message',
        };
        connection.send(JSON.stringify(errorResponse));
      }
    });

    connection.on('close', async () => {
      if (sessionId) {
        await destroyParticipantProviders();
        await finalizeMeeting(sessionId);
        await sessionManager.destroySession(sessionId);
        server.log.info({ conn, sessionId }, 'WebSocket closed, session destroyed');
      } else {
        server.log.info({ conn }, 'WebSocket closed');
      }
    });

    connection.on('error', async () => {
      server.log.warn({ conn, sessionId }, 'WebSocket error');
      await destroyParticipantProviders();
      if (sessionId) {
        await finalizeMeeting(sessionId);
        await sessionManager.destroySession(sessionId);
      }
    });
  });
}
