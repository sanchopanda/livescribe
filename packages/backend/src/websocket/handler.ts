import type { FastifyInstance } from 'fastify';
import type { SocketStream } from '@fastify/websocket';
import type { ClientMessage, ServerMessage } from '@livescribe/shared';
import { SessionManager } from './session.js';

const sessionManager = new SessionManager();

export function registerWebSocketHandler(server: FastifyInstance) {
  server.get('/ws', { websocket: true }, (connection, req) => {
    let sessionId: string | null = null;

    server.log.info('WebSocket client connected');

    connection.on('message', async (data: Buffer) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());

        switch (message.type) {
          case 'start': {
            sessionId = sessionManager.createSession(connection);
            server.log.info(`Session started: ${sessionId}`);

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

            // Decode base64 audio chunk
            const audioBuffer = Buffer.from(message.chunk, 'base64');
            server.log.debug(
              `Received audio chunk: ${audioBuffer.byteLength} bytes, session: ${sessionId}`
            );

            // TODO: Process audio (send to STT service)
            // For MVP: just log the receipt
            sessionManager.logAudioChunk(sessionId, audioBuffer.byteLength);

            break;
          }

          case 'stop': {
            if (sessionId) {
              sessionManager.destroySession(sessionId);
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

    connection.on('close', () => {
      if (sessionId) {
        sessionManager.destroySession(sessionId);
        server.log.info(`WebSocket closed, session destroyed: ${sessionId}`);
      } else {
        server.log.info('WebSocket closed');
      }
    });

    connection.on('error', (err) => {
      server.log.error('WebSocket error:', err);
      if (sessionId) {
        sessionManager.destroySession(sessionId);
      }
    });
  });
}
