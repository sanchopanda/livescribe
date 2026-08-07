// Складывает события прогона: построчный JSONL (для отчёта), плоский текст (для чтения глазами)
// и метафайл с фактической длительностью поданного аудио (для report.ts, см. meta.ts).

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { ProviderName, SmokeEvent } from './types.js';
import { metaPath } from './meta.js';

export class EventSink {
  private readonly collected: SmokeEvent[] = [];
  private readonly stream: WriteStream;
  private readonly jsonlPath: string;
  private readonly txtPath: string;
  private readonly metaFilePath: string;

  constructor(outDir: string, basename: string, provider: ProviderName) {
    mkdirSync(outDir, { recursive: true });
    this.jsonlPath = join(outDir, `${basename}-${provider}.jsonl`);
    this.txtPath = join(outDir, `${basename}-${provider}.txt`);
    this.metaFilePath = metaPath(outDir, basename, provider);
    this.stream = createWriteStream(this.jsonlPath, { encoding: 'utf8' });
  }

  add(event: SmokeEvent): void {
    this.collected.push(event);
    this.stream.write(`${JSON.stringify(event)}\n`);
  }

  get events(): SmokeEvent[] {
    return this.collected;
  }

  /**
   * audioSec — фактическая длительность аудио, поданного в этом прогоне (после --seconds,
   * если он был), а не длина всего WAV-файла. Пишем рядом метафайлом, чтобы report.ts знал
   * реальную длительность и не считал стоимость/tailLatencyMs по обрезанному прогону так,
   * будто подан целый файл.
   */
  async close(audioSec: number): Promise<{ jsonlPath: string; txtPath: string; metaPath: string }> {
    const finals = this.collected.filter((e) => e.isFinal).map((e) => e.text.trim()).filter(Boolean);
    await new Promise<void>((resolve, reject) => {
      this.stream.end(() => resolve());
      this.stream.on('error', reject);
    });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(this.txtPath, `${finals.join(' ')}\n`, 'utf8');
    await writeFile(this.metaFilePath, `${JSON.stringify({ audioSec }, null, 2)}\n`, 'utf8');
    return { jsonlPath: this.jsonlPath, txtPath: this.txtPath, metaPath: this.metaFilePath };
  }
}
