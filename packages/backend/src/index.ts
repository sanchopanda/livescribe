import { config } from 'dotenv';
import { createServer } from './server.js';

// Load environment variables
config();

const PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT, 10) : 3001;

async function start() {
  try {
    const server = await createServer();

    await server.listen({
      port: PORT,
      host: '0.0.0.0',
    });

    server.log.info(`WebSocket server running on ws://localhost:${PORT}`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
