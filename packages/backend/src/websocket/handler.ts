import type { FastifyInstance } from 'fastify';
import type { SocketStream } from '@fastify/websocket';
import type { ClientMessage, ServerMessage } from '@livescribe/shared';
import { SessionManager } from './session.js';
import { createSTTProvider } from '../stt/index.js';

const sessionManager = new SessionManager();
const STT_PROVIDER_TYPE = (process.env.STT_PROVIDER as 'whisper' | 'vosk') || 'vosk';

export function registerWebSocketHandler(server: FastifyInstance) {
  server.get('/ws', { websocket: true }, (connection, req) => {
    let sessionId: string | null = null;

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
              sttProvider = createSTTProvider(STT_PROVIDER_TYPE);
              await sttProvider.initialize(language);
              server.log.info(`STT provider (${STT_PROVIDER_TYPE}) initialized for language: ${language}`);
            } catch (err) {
              server.log.warn(`STT provider initialization failed (audio will still be saved):`, err);
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

            // Process audio through STT (if available)
            if (session.sttProvider) {
              try {
                const sttResult = await session.sttProvider.processAudio(audioBuffer);
              
              if (sttResult && sttResult.text) {
                // Send transcription to client
                const transcriptMessage: ServerMessage = sttResult.isFinal
                  ? {
                      type: 'final',
                      text: sttResult.text,
                      timestamp: Date.now(),
                      confidence: sttResult.confidence,
                    }
                  : {
                      type: 'partial',
                      text: sttResult.text,
                      timestamp: Date.now(),
                      confidence: sttResult.confidence,
                    };

                connection.send(JSON.stringify(transcriptMessage));
                server.log.debug(`Transcription (${sttResult.isFinal ? 'final' : 'partial'}): ${sttResult.text}`);
              }
            } catch (err) {
                // Log error but don't fail - STT might not be available
                const errorMsg = (err as Error).message;
                if (!errorMsg.includes('not supported') && !errorMsg.includes('compatibility')) {
                  server.log.error('STT processing error:', err);
                } else {
                  server.log.warn('STT not available:', errorMsg);
                }
                // Don't fail the connection, audio will still be saved
              }
            }

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
        server.log.error('Error processing WebSocket message:', err);

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
      server.log.error('WebSocket error:', err);
      if (sessionId) {
        await sessionManager.destroySession(sessionId);
      }
    });
  });
}
