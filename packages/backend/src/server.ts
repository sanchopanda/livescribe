import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { registerWebSocketHandler } from './websocket/handler.js';

export async function createServer() {
  const server = Fastify({
    logger: {
      transport:
        process.env.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
  });

  // Register plugins
  await server.register(cors, {
    origin: true, // Allow all origins in development
  });

  await server.register(websocket);

  // Register WebSocket routes
  registerWebSocketHandler(server);

  // Health check endpoint
  server.get('/health', async () => {
    return { status: 'ok', timestamp: Date.now() };
  });

  return server;
}
