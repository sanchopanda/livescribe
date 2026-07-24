import { config } from 'dotenv';
import { createServer } from './server.js';

// Load environment variables
config();

// Refuse to boot in production without required secrets configured.
if (process.env.NODE_ENV === 'production') {
  const missing: string[] = [];
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `Refusing to start in production: missing required environment variable(s): ${missing.join(', ')}`
    );
    process.exit(1);
  }
}

const PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3001;

async function start() {
  try {
    const server = await createServer();

    await server.listen({
      port: PORT,
      host: '0.0.0.0',
    });

    // server.log.info(`WebSocket server running on ws://localhost:${PORT}`);
  } catch {
    // console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
