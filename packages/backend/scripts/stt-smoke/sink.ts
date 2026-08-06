// Складывает события прогона: построчный JSONL (для отчёта) и плоский текст (для чтения глазами).

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { ProviderName, SmokeEvent } from './types.js';

export class EventSink {
  private readonly collected: SmokeEvent[] = [];
  private readonly stream: WriteStream;
  private readonly jsonlPath: string;
  private readonly txtPath: string;

  constructor(outDir: string, basename: string, provider: ProviderName) {
    mkdirSync(outDir, { recursive: true });
    this.jsonlPath = join(outDir, `${basename}-${provider}.jsonl`);
    this.txtPath = join(outDir, `${basename}-${provider}.txt`);
    this.stream = createWriteStream(this.jsonlPath, { encoding: 'utf8' });
  }

  add(event: SmokeEvent): void {
    this.collected.push(event);
    this.stream.write(`${JSON.stringify(event)}\n`);
  }

  get events(): SmokeEvent[] {
    return this.collected;
  }

  async close(): Promise<{ jsonlPath: string; txtPath: string }> {
    const finals = this.collected.filter((e) => e.isFinal).map((e) => e.text.trim()).filter(Boolean);
    await new Promise<void>((resolve, reject) => {
      this.stream.end(() => resolve());
      this.stream.on('error', reject);
    });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(this.txtPath, `${finals.join(' ')}\n`, 'utf8');
    return { jsonlPath: this.jsonlPath, txtPath: this.txtPath };
  }
}
