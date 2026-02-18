import type { FastifyInstance } from 'fastify';
import type { ClientMessage, ServerMessage } from '@livescribe/shared';
import { SessionManager } from './session.js';
import { createSTTProvider } from '../stt/index.js';

const sessionManager = new SessionManager();

// Get STT provider type - read from env at runtime, not at module load
// This ensures dotenv.config() has been called first
function getSTTProviderType(): 'vosk' | 'deepgram' {
  return (process.env.STT_PROVIDER as 'vosk' | 'deepgram') || 'vosk';
}

export function registerWebSocketHandler(server: FastifyInstance) {
  server.get('/ws', { websocket: true }, (connection, _req) => {
    let sessionId: string | null = null;
    let lastDomSpeaker: string | null = null;
    const speakerEvents: Array<{ speaker: string; timestamp: number }> = [];
    const activeDiarizeLabels: string[] = [];
    let lastResultAt = 0;

    const RESULT_GROUP_GAP_MS = 1200;
    const SPEAKER_WINDOW_MS = 8000;

    const isDeepgramSpeakerLabel = (speaker?: string): boolean => {
      if (!speaker) return false;
      return /^DG Speaker\s+\d+$/i.test(speaker.trim());
    };

    const rememberDomSpeaker = (speaker?: string | null, timestamp?: number) => {
      const normalized = speaker?.trim();
      if (!normalized) return;

      if (normalized === lastDomSpeaker) {
        return;
      }

      lastDomSpeaker = normalized;
      speakerEvents.push({ speaker: normalized, timestamp: typeof timestamp === 'number' ? timestamp : Date.now() });

      // Keep only recent history window
      const cutoff = Date.now() - 30_000;
      while (speakerEvents.length > 0 && speakerEvents[0].timestamp < cutoff) {
        speakerEvents.shift();
      }
    };

    const getOrderedSpeakersFromWindow = (nowTs: number): string[] => {
      const fromTs = nowTs - SPEAKER_WINDOW_MS;
      return speakerEvents
        .filter((event) => event.timestamp >= fromTs)
        .map((event) => event.speaker)
        .filter((speaker, index, arr) => arr.indexOf(speaker) === index);
    };

    const resolveDiarizedSpeakerToWindow = (dgSpeaker?: string, fallbackSpeaker?: string | null): string | undefined => {
      if (!dgSpeaker || !isDeepgramSpeakerLabel(dgSpeaker)) {
        return fallbackSpeaker ?? undefined;
      }

      const nowTs = Date.now();

      // New result group: reset local label ordering.
      if (lastResultAt === 0 || nowTs - lastResultAt > RESULT_GROUP_GAP_MS) {
        activeDiarizeLabels.length = 0;
      }
      lastResultAt = nowTs;

      if (!activeDiarizeLabels.includes(dgSpeaker)) {
        activeDiarizeLabels.push(dgSpeaker);
      }

      const diarizeIndex = activeDiarizeLabels.indexOf(dgSpeaker);
      const orderedWindowSpeakers = getOrderedSpeakersFromWindow(nowTs);

      return orderedWindowSpeakers[diarizeIndex] ?? fallbackSpeaker ?? orderedWindowSpeakers[orderedWindowSpeakers.length - 1];
    };

    server.log.info('WebSocket client connected');

    connection.on('message', async (data: Buffer) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());

        switch (message.type) {
          case 'start': {
            const language = message.language || 'ru-RU';
            
            // Create STT provider (optional - audio will still be saved even if STT fails)
            let sttProvider: any = null;
            try {
              const providerType = getSTTProviderType();
              server.log.info(`Using STT provider: ${providerType} (from env: ${process.env.STT_PROVIDER || 'not set'})`);
              sttProvider = createSTTProvider(providerType);
              
              // Create callback for real-time transcriptions (for streaming providers like Deepgram)
              const onResult = (result: any) => {
                const session = sessionId ? sessionManager.getSession(sessionId) : undefined;
                const resolvedSpeaker = isDeepgramSpeakerLabel(result.speaker)
                  ? resolveDiarizedSpeakerToWindow(result.speaker, session?.speaker)
                  : result.speaker ?? session?.speaker ?? undefined;

                const transcriptMessage: ServerMessage = result.isFinal
                  ? {
                      type: 'final',
                      text: result.text,
                      timestamp: Date.now(),
                      confidence: result.confidence ?? 0,
                      speaker: resolvedSpeaker,
                    }
                  : {
                      type: 'partial',
                      text: result.text,
                      timestamp: Date.now(),
                      confidence: result.confidence,
                      speaker: resolvedSpeaker,
                    };
                connection.send(JSON.stringify(transcriptMessage));
                server.log.debug(`Transcription (${result.isFinal ? 'final' : 'partial'}): ${result.text}`);
              };
              
              await sttProvider.initialize(language, onResult);
              server.log.info(`STT provider (${providerType}) initialized for language: ${language}`);
            } catch (err) {
              server.log.error(`STT provider initialization failed (audio will still be saved): ${(err as Error).message}`);
              server.log.error(err, 'STT initialization error details');
              // Set sttProvider to null to ensure it's not used
              sttProvider = null;
              // Continue without STT - audio will still be saved to files
              // Send warning to client
              const warningResponse: ServerMessage = {
                type: 'error',
                code: 'STT_UNAVAILABLE',
                message: `STT not available: ${(err as Error).message}. Audio will be saved but not transcribed.`,
              };
              connection.send(JSON.stringify(warningResponse));
              // Continue anyway - create session without STT provider
            }

            // Create session with STT provider
            sessionId = sessionManager.createSession(connection, sttProvider, language);
            server.log.info(`Session started: ${sessionId} with language: ${language}`);

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
              server.log.warn('Received audio chunk without active session');
              return;
            }

            const session = sessionManager.getSession(sessionId);
            if (!session || !session.sttProvider) {
              server.log.warn('Session or STT provider not found');
              return;
            }

            // Decode base64 audio chunk
            const audioBuffer = Buffer.from(message.chunk, 'base64');
            server.log.debug(
              `Received audio chunk: ${audioBuffer.byteLength} bytes, session: ${sessionId}`
            );

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
                server.log.debug(`Transcription (${sttResult.isFinal ? 'final' : 'partial'}): ${sttResult.text}`);
              }
            } catch (err) {
                // Log error but don't fail - STT might not be available
                const errorMsg = (err as Error).message;
                if (!errorMsg.includes('not supported') && !errorMsg.includes('compatibility')) {
                  server.log.error(`STT processing error: ${errorMsg}`);
                } else {
                  server.log.warn(`STT not available: ${errorMsg}`);
                }
                // Don't fail the connection, audio will still be saved
              }
            }

            break;
          }

          case 'speaker': {
            if (!sessionId) {
              server.log.warn('Received speaker update without active session');
              return;
            }

            const session = sessionManager.getSession(sessionId);
            if (!session) {
              server.log.warn('Received speaker update for missing session');
              return;
            }

            session.speaker = message.speaker ?? null;
            rememberDomSpeaker(message.speaker ?? null, (message as any).timestamp);
            break;
          }

          case 'stop': {
            if (sessionId) {
              await sessionManager.destroySession(sessionId);
              server.log.info(`Session stopped: ${sessionId}`);

              const response: ServerMessage = {
                type: 'status',
                status: 'idle',
              };
              connection.send(JSON.stringify(response));
              sessionId = null;
            }
            break;
          }

          default:
            server.log.warn(`Unknown message type: ${(message as any).type}`);
        }
      } catch (err) {
        server.log.error(`Error processing WebSocket message: ${(err as Error).message}`);

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
        await sessionManager.destroySession(sessionId);
        server.log.info(`WebSocket closed, session destroyed: ${sessionId}`);
      } else {
        server.log.info('WebSocket closed');
      }
    });

    connection.on('error', async (err) => {
      server.log.error(`WebSocket error: ${(err as Error).message}`);
      if (sessionId) {
        await sessionManager.destroySession(sessionId);
      }
    });
  });
}
