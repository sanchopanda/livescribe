import type { FastifyInstance } from 'fastify';
import type { ClientMessage, ServerMessage } from '@livescribe/shared';
import { SessionManager } from './session.js';
import { createSTTProvider } from '../stt/index.js';

const sessionManager = new SessionManager();
let wsConnectionSequence = 0;

// Get STT provider type - read from env at runtime, not at module load
// This ensures dotenv.config() has been called first
function getSTTProviderType(): 'vosk' | 'deepgram' {
  return (process.env.STT_PROVIDER as 'vosk' | 'deepgram') || 'vosk';
}

export function registerWebSocketHandler(server: FastifyInstance) {
  server.get('/ws', { websocket: true }, (connection, _req) => {
    const connectionId = ++wsConnectionSequence;
    const conn = `ws#${connectionId}`;
    let sessionId: string | null = null;
    let activeLanguage: 'ru-RU' | 'en-US' = 'ru-RU';
    let activeProviderType: 'vosk' | 'deepgram' = getSTTProviderType();
    const participantProviders = new Map<string, { provider: any; speaker: string | null }>();
    const participantChunkCount = new Map<string, number>();

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
    };

    // server.log.info('WebSocket client connected');

    connection.on('message', async (data: Buffer) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());

        switch (message.type) {
          case 'start': {
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
            
            // Create STT provider (optional - audio will still be saved even if STT fails)
            let sttProvider: any = null;
            try {
              const providerType = activeProviderType;
              // server.log.info(`Using STT provider: ${providerType} (from env: ${process.env.STT_PROVIDER || 'not set'})`);
              sttProvider = createSTTProvider(providerType);
              
              // Create callback for real-time transcriptions (for streaming providers like Deepgram)
              const onResult = (result: any) => {
                const session = sessionId ? sessionManager.getSession(sessionId) : undefined;
                const resolvedSpeaker = session?.speaker ?? undefined;

                sendTranscript(result, resolvedSpeaker);
                // server.log.debug(`Transcription (${result.isFinal ? 'final' : 'partial'}): ${result.text}`);
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
            sessionId = sessionManager.createSession(connection, sttProvider, language);
            server.log.info({ conn, sessionId, language }, 'Session started');

            const response: ServerMessage = {
              type: 'status',
              status: 'connected',
              sessionId,
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
                participantEntry = {
                  provider: participantProvider,
                  speaker: normalizedParticipantSpeaker ?? null,
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

                await participantProvider.initialize(activeLanguage, (result: any) => {
                  const resolvedSpeaker = participantEntry?.speaker ?? formatParticipantFallback(participantId);
                  sendTranscript(result, resolvedSpeaker || undefined);
                });
              } else if (normalizedParticipantSpeaker) {
                participantEntry.speaker = normalizedParticipantSpeaker;
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

            // Process audio through STT (if available and initialized)
            if (session.sttProvider) {
              try {
                // Pass format information if available
                const format = (message as any).format; // 'pcm' or 'ogg-opus'
                const sttResult = await session.sttProvider.processAudio(audioBuffer, format);
              
              if (sttResult && sttResult.text) {
                // Send transcription to client
                 const transcriptMessage: ServerMessage = sttResult.isFinal
                   ? {
                       type: 'final',
                       text: sttResult.text,
                       timestamp: Date.now(),
                       confidence: sttResult.confidence ?? 0,
                       speaker: sttResult.speaker ?? session.speaker ?? undefined,
                     }
                   : {
                       type: 'partial',
                       text: sttResult.text,
                       timestamp: Date.now(),
                       confidence: sttResult.confidence,
                       speaker: sttResult.speaker ?? session.speaker ?? undefined,
                     };

                connection.send(JSON.stringify(transcriptMessage));
                server.log.info(
                  {
                    conn,
                    sessionId,
                    isFinal: sttResult.isFinal,
                    textLength: sttResult.text.length,
                    speaker: sttResult.speaker ?? session.speaker ?? null,
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
            server.log.info({ conn, sessionId, speaker: session.speaker }, 'Speaker update received');
            break;
          }

          case 'stop': {
            if (sessionId) {
              await destroyParticipantProviders();
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
        await sessionManager.destroySession(sessionId);
      }
    });
  });
}
