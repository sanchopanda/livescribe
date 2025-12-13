import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { registerWebSocketHandler } from './websocket/handler.js';
import { readdirSync, statSync, createReadStream } from 'fs';
import { join } from 'path';

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

  // List recordings
  server.get('/recordings', async (request, reply) => {
    try {
      const recordingsDir = join(process.cwd(), 'recordings');
      const files = readdirSync(recordingsDir)
        .filter((file) => file.endsWith('.wav'))
        .map((file) => {
          const filepath = join(recordingsDir, file);
          const stats = statSync(filepath);
          return {
            filename: file,
            size: stats.size,
            createdAt: stats.birthtime,
            modifiedAt: stats.mtime,
          };
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      return { recordings: files };
    } catch (err) {
      reply.code(500);
      return { error: 'Failed to list recordings', message: (err as Error).message };
    }
  });

  // Download recording
  server.get('/recordings/:filename', async (request, reply) => {
    try {
      const { filename } = request.params as { filename: string };
      
      // Security: only allow .wav files
      if (!filename.endsWith('.wav')) {
        reply.code(400);
        return { error: 'Invalid file type' };
      }

      const recordingsDir = join(process.cwd(), 'recordings');
      const filepath = join(recordingsDir, filename);

      // Check if file exists
      try {
        statSync(filepath);
      } catch {
        reply.code(404);
        return { error: 'Recording not found' };
      }

      // Stream file
      const stream = createReadStream(filepath);
      reply.type('audio/wav');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(stream);
    } catch (err) {
      reply.code(500);
      return { error: 'Failed to download recording', message: (err as Error).message };
    }
  });

  return server;
}
