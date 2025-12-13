import type { WebSocket } from '@fastify/websocket';
import { randomUUID } from 'crypto';

interface Session {
  id: string;
  connection: WebSocket;
  createdAt: number;
  audioChunksReceived: number;
  totalBytesReceived: number;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();

  createSession(connection: WebSocket): string {
    const sessionId = randomUUID();

    const session: Session = {
      id: sessionId,
      connection,
      createdAt: Date.now(),
      audioChunksReceived: 0,
      totalBytesReceived: 0,
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  destroySession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      console.log(
        `Session ${sessionId} stats:`,
        `Chunks: ${session.audioChunksReceived},`,
        `Total bytes: ${session.totalBytesReceived}`
      );
      return this.sessions.delete(sessionId);
    }
    return false;
  }

  logAudioChunk(sessionId: string, byteLength: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.audioChunksReceived++;
      session.totalBytesReceived += byteLength;

      // Log every 10 chunks
      if (session.audioChunksReceived % 10 === 0) {
        console.log(
          `Session ${sessionId}: ${session.audioChunksReceived} chunks, ${session.totalBytesReceived} bytes total`
        );
      }
    }
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  getSessionCount(): number {
    return this.sessions.size;
  }
}
