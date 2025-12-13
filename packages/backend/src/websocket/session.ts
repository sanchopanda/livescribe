import type { WebSocket } from '@fastify/websocket';
import { randomUUID } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { STTProvider } from '../stt/types.js';

interface Session {
  id: string;
  connection: WebSocket;
  createdAt: number;
  audioChunksReceived: number;
  totalBytesReceived: number;
  audioChunks: Buffer[];
  sttProvider: STTProvider | null;
  language: string;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();

  createSession(connection: WebSocket, sttProvider: STTProvider, language: string): string {
    const sessionId = randomUUID();

    const session: Session = {
      id: sessionId,
      connection,
      createdAt: Date.now(),
      audioChunksReceived: 0,
      totalBytesReceived: 0,
      audioChunks: [],
      sttProvider,
      language,
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  async destroySession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (session) {
      console.log(
        `Session ${sessionId} stats:`,
        `Chunks: ${session.audioChunksReceived},`,
        `Total bytes: ${session.totalBytesReceived}`
      );

      // Finalize STT and get last transcription
      if (session.sttProvider) {
        try {
          const finalResult = await session.sttProvider.finalize();
          if (finalResult) {
            console.log(`Final transcription: ${finalResult.text}`);
          }
          await session.sttProvider.destroy();
        } catch (err) {
          console.error(`Failed to finalize STT for session ${sessionId}:`, err);
        }
      }

      // Save audio to WAV file if we have chunks
      if (session.audioChunks.length > 0) {
        try {
          const wavFile = this.saveAudioToWav(sessionId, session.audioChunks);
          console.log(`Audio saved to: ${wavFile}`);
        } catch (err) {
          console.error(`Failed to save audio for session ${sessionId}:`, err);
        }
      }

      return this.sessions.delete(sessionId);
    }
    return false;
  }

  private saveAudioToWav(sessionId: string, audioChunks: Buffer[]): string {
    // Combine all audio chunks
    const totalLength = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const audioData = Buffer.concat(audioChunks, totalLength);

    // WAV file parameters
    const sampleRate = 16000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = audioData.length;
    const fileSize = 36 + dataSize;

    // Create WAV header
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(fileSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // fmt chunk size
    header.writeUInt16LE(1, 20); // audio format (PCM)
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    // Combine header and audio data
    const wavBuffer = Buffer.concat([header, audioData]);

    // Create recordings directory if it doesn't exist
    const recordingsDir = join(process.cwd(), 'recordings');
    try {
      mkdirSync(recordingsDir, { recursive: true });
    } catch (err) {
      // Directory might already exist
    }

    // Save file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `recording-${sessionId.slice(0, 8)}-${timestamp}.wav`;
    const filepath = join(recordingsDir, filename);

    writeFileSync(filepath, wavBuffer);

    return filepath;
  }

  addAudioChunk(sessionId: string, audioBuffer: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.audioChunks.push(audioBuffer);
      session.audioChunksReceived++;
      session.totalBytesReceived += audioBuffer.byteLength;

      // Log every 10 chunks
      if (session.audioChunksReceived % 10 === 0) {
        console.log(
          `Session ${sessionId}: ${session.audioChunksReceived} chunks, ${session.totalBytesReceived} bytes total`
        );
      }
    }
  }

  logAudioChunk(sessionId: string, byteLength: number): void {
    // Deprecated: use addAudioChunk instead
    const session = this.sessions.get(sessionId);
    if (session) {
      session.audioChunksReceived++;
      session.totalBytesReceived += byteLength;
    }
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  getSessionCount(): number {
    return this.sessions.size;
  }
}
