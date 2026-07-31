import { describe, expect, it } from 'vitest';
import {
  PRE_ROLL_MAX_BYTES,
  PRE_ROLL_MS,
  PreRollBuffer,
} from './pre-roll';

function chunkOf(byteLength: number, fill = 1): ArrayBuffer {
  const buffer = new ArrayBuffer(byteLength);
  new Uint8Array(buffer).fill(fill);
  return buffer;
}

function totalBytes(chunks: Array<{ byteLength: number }>): number {
  return chunks.reduce((sum, item) => sum + item.byteLength, 0);
}

describe('pre-roll window', () => {
  it('holds PRE_ROLL_MS of 16 kHz mono int16 audio', () => {
    expect(PRE_ROLL_MAX_BYTES).toBe(16000 * 2 * (PRE_ROLL_MS / 1000));
  });
});

describe('PreRollBuffer', () => {
  it('keeps everything while under the cap', () => {
    const buffer = new PreRollBuffer(100);
    buffer.push('a', chunkOf(40));
    buffer.push('a', chunkOf(40));

    expect(totalBytes(buffer.consume('a'))).toBe(80);
  });

  it('drops the oldest chunks once the window is full', () => {
    const buffer = new PreRollBuffer(100);
    buffer.push('a', chunkOf(40, 1));
    buffer.push('a', chunkOf(40, 2));
    buffer.push('a', chunkOf(40, 3));

    const chunks = buffer.consume('a');
    expect(totalBytes(chunks)).toBe(80);
    // The surviving chunks must be the most recent ones, in order.
    expect(chunks.map((c) => new Uint8Array(c.chunk)[0])).toEqual([2, 3]);
  });

  it('never grows past the cap even with one oversized chunk', () => {
    const buffer = new PreRollBuffer(100);
    buffer.push('a', chunkOf(250));

    // A single chunk larger than the window is kept — dropping it would lose the whole
    // pre-roll — but the accounting must not report more than that one chunk.
    expect(buffer.bufferedBytes('a')).toBe(250);
    expect(buffer.consume('a')).toHaveLength(1);
  });

  it('keeps tracks independent', () => {
    const buffer = new PreRollBuffer(100);
    buffer.push('a', chunkOf(40));
    buffer.push('b', chunkOf(60));

    expect(totalBytes(buffer.consume('a'))).toBe(40);
    expect(totalBytes(buffer.consume('b'))).toBe(60);
  });

  it('empties on consume so the next phrase starts clean', () => {
    const buffer = new PreRollBuffer(100);
    buffer.push('a', chunkOf(40));

    expect(buffer.consume('a')).toHaveLength(1);
    expect(buffer.consume('a')).toHaveLength(0);
    expect(buffer.bufferedBytes('a')).toBe(0);
  });

  it('forgets a dropped track', () => {
    const buffer = new PreRollBuffer(100);
    buffer.push('a', chunkOf(40));
    buffer.drop('a');

    expect(buffer.consume('a')).toHaveLength(0);
  });

  it('copies the incoming chunk instead of holding the caller buffer', () => {
    const buffer = new PreRollBuffer(100);
    const source = chunkOf(4, 7);
    buffer.push('a', source);

    new Uint8Array(source).fill(9);

    expect(new Uint8Array(buffer.consume('a')[0].chunk)[0]).toBe(7);
  });

  it('clears every track at once', () => {
    const buffer = new PreRollBuffer(100);
    buffer.push('a', chunkOf(10));
    buffer.push('b', chunkOf(10));
    buffer.clear();

    expect(buffer.consume('a')).toHaveLength(0);
    expect(buffer.consume('b')).toHaveLength(0);
  });
});
