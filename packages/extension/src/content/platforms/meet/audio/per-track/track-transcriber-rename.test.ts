import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pins the race fixed for LS-35: `sendParticipantRename` is fired with `void` (not awaited) from
 * the 250ms tick, and the redelivery walk that follows it in the same synchronous turn must not
 * see the send as "not yet delivered" just because the `chrome.runtime.sendMessage` round-trip
 * hasn't resolved yet. The class itself needs a browser (AudioContext, DOM, chrome.*) for
 * `start()`/`syncTracks()`, which this suite does not touch — only the pure bookkeeping around
 * `sendParticipantRename` is exercised here, via stubbed `localStorage` (read once at module
 * load) and a mocked `chrome.runtime.sendMessage`.
 */

declare const global: typeof globalThis;

async function loadTranscriber() {
  vi.resetModules();
  (global as any).localStorage = { getItem: () => '0' };
  const mod = await import('./track-transcriber');
  return mod.MeetTrackTranscriber;
}

describe('MeetTrackTranscriber — sendParticipantRename bookkeeping', () => {
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMessage = vi.fn();
    (global as any).chrome = { runtime: { sendMessage, getURL: (p: string) => p } };
  });

  afterEach(() => {
    delete (global as any).chrome;
    delete (global as any).localStorage;
  });

  it('записывает отправку до ответа — редоставка не увидит только что подтверждённого как недоставленного', async () => {
    // The invariant this closes: without the optimistic write, the redelivery walk running
    // synchronously right after a void-called send would find nothing recorded yet (the reply
    // cannot have arrived within the same tick) and fire a duplicate.
    let resolveReply!: (value: unknown) => void;
    sendMessage.mockReturnValue(new Promise((resolve) => (resolveReply = resolve)));

    const MeetTrackTranscriber = await loadTranscriber();
    const transcriber: any = new MeetTrackTranscriber();

    const pending = transcriber.sendParticipantRename('p1', 'Сергей Чумеров');

    // Synchronously after the call, before the reply resolves: already recorded.
    expect(transcriber.sentRenameByParticipantId.get('p1')).toBe('Сергей Чумеров');

    resolveReply({ success: true });
    await pending;

    // Delivered: still recorded, exactly the once.
    expect(transcriber.sentRenameByParticipantId.get('p1')).toBe('Сергей Чумеров');
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('откатывает запись при отклонённом промисе — следующий такт повторит отправку', async () => {
    sendMessage.mockRejectedValueOnce(new Error('service worker inactive'));

    const MeetTrackTranscriber = await loadTranscriber();
    const transcriber: any = new MeetTrackTranscriber();

    await transcriber.sendParticipantRename('p1', 'Сергей Чумеров');

    // Rolled back: a later tick's redelivery walk sees this participant as undelivered again.
    expect(transcriber.sentRenameByParticipantId.has('p1')).toBe(false);
  });

  it('откатывает запись при ответе с error — оффскрин не смог отправить (сокет не OPEN)', async () => {
    sendMessage.mockResolvedValueOnce({ error: 'WebSocket is not connected' });

    const MeetTrackTranscriber = await loadTranscriber();
    const transcriber: any = new MeetTrackTranscriber();

    await transcriber.sendParticipantRename('p1', 'Сергей Чумеров');

    expect(transcriber.sentRenameByParticipantId.has('p1')).toBe(false);
  });

  it('не затирает более новую успешную запись, если старая (уже неактуальная) попытка проваливается позже', async () => {
    // Send #1 (Alice) is still in flight when send #2 (Bob) for the same participant completes
    // first and succeeds. Send #1's later failure must roll back only its own value, not Bob's.
    let resolveFirst!: (value: unknown) => void;
    sendMessage.mockImplementationOnce(() => new Promise((_, reject) => (resolveFirst = reject as any)));
    sendMessage.mockResolvedValueOnce({ success: true });

    const MeetTrackTranscriber = await loadTranscriber();
    const transcriber: any = new MeetTrackTranscriber();

    const first = transcriber.sendParticipantRename('p1', 'Alice');
    expect(transcriber.sentRenameByParticipantId.get('p1')).toBe('Alice');

    await transcriber.sendParticipantRename('p1', 'Bob');
    expect(transcriber.sentRenameByParticipantId.get('p1')).toBe('Bob');

    resolveFirst(new Error('late failure'));
    await first.catch(() => {});

    // Bob's entry must survive Alice's late rollback.
    expect(transcriber.sentRenameByParticipantId.get('p1')).toBe('Bob');
  });
});
