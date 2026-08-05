import { describe, expect, it, vi } from 'vitest';
import {
  watchLocalTracksFromUserMedia,
  watchLocalTracksOnPeerConnection,
} from './local-track-hook';

const audioTrack = (id: string) => ({ kind: 'audio', id });
const videoTrack = (id: string) => ({ kind: 'video', id });

describe('watchLocalTracksOnPeerConnection', () => {
  it('sees the microphone the page attaches for sending', () => {
    // `ontrack` only ever fires for inbound tracks, so an outgoing mic is invisible without this.
    const seen: unknown[] = [];
    const original = vi.fn(() => ({ sender: true }));
    const pc: any = { addTrack: original };

    watchLocalTracksOnPeerConnection(pc, (t) => seen.push(t));
    const mic = audioTrack('mic-1');
    const result = pc.addTrack(mic, { id: 'stream-1' });

    expect(seen).toEqual([mic]);
    expect(original).toHaveBeenCalledWith(mic, { id: 'stream-1' });
    expect(result).toEqual({ sender: true });
  });

  it('ignores outgoing video', () => {
    const seen: unknown[] = [];
    const pc: any = { addTrack: vi.fn(() => ({})) };

    watchLocalTracksOnPeerConnection(pc, (t) => seen.push(t));
    pc.addTrack(videoTrack('cam-1'));

    expect(seen).toEqual([]);
  });

  it('sees a microphone added through addTransceiver', () => {
    const seen: unknown[] = [];
    const original = vi.fn(() => ({ transceiver: true }));
    const pc: any = { addTransceiver: original };

    watchLocalTracksOnPeerConnection(pc, (t) => seen.push(t));
    const mic = audioTrack('mic-2');
    const result = pc.addTransceiver(mic, { direction: 'sendonly' });

    expect(seen).toEqual([mic]);
    expect(result).toEqual({ transceiver: true });
  });

  it('does not trip over addTransceiver called with a kind string', () => {
    const seen: unknown[] = [];
    const pc: any = { addTransceiver: vi.fn(() => ({})) };

    watchLocalTracksOnPeerConnection(pc, (t) => seen.push(t));

    expect(() => pc.addTransceiver('audio', { direction: 'recvonly' })).not.toThrow();
    expect(seen).toEqual([]);
  });

  it('reports a track swapped in on unmute', () => {
    // Muting often replaces the sender's track rather than adding a new one.
    const seen: unknown[] = [];
    const sender: any = { replaceTrack: vi.fn(() => Promise.resolve()) };
    const pc: any = { addTrack: vi.fn(() => sender), getSenders: () => [sender] };

    watchLocalTracksOnPeerConnection(pc, (t) => seen.push(t));
    const returned = pc.addTrack(audioTrack('mic-3'));
    const fresh = audioTrack('mic-4');
    returned.replaceTrack(fresh);

    expect(seen).toEqual([audioTrack('mic-3'), fresh]);
  });

  it('survives a peer connection without these methods', () => {
    expect(() => watchLocalTracksOnPeerConnection({} as any, () => {})).not.toThrow();
  });

  it('reports one track once, however many times it is attached', () => {
    const seen: unknown[] = [];
    const pc: any = { addTrack: vi.fn(() => ({})) };

    watchLocalTracksOnPeerConnection(pc, (t) => seen.push(t));
    const mic = audioTrack('mic-5');
    pc.addTrack(mic);
    pc.addTrack(mic);

    expect(seen).toEqual([mic]);
  });
});

describe('watchLocalTracksFromUserMedia', () => {
  it('sees the microphone as soon as the page asks for it', async () => {
    const seen: unknown[] = [];
    const mic = audioTrack('gum-1');
    const stream = { getAudioTracks: () => [mic] };
    const mediaDevices: any = { getUserMedia: vi.fn(() => Promise.resolve(stream)) };

    watchLocalTracksFromUserMedia(mediaDevices, (t) => seen.push(t));
    const result = await mediaDevices.getUserMedia({ audio: true });

    expect(seen).toEqual([mic]);
    expect(result).toBe(stream);
  });

  it('lets a rejection through untouched', async () => {
    const denied = new Error('NotAllowedError');
    const mediaDevices: any = { getUserMedia: vi.fn(() => Promise.reject(denied)) };

    watchLocalTracksFromUserMedia(mediaDevices, () => {
      throw new Error('must not be called');
    });

    await expect(mediaDevices.getUserMedia({ audio: true })).rejects.toBe(denied);
  });

  it('ignores a camera-only request', async () => {
    const seen: unknown[] = [];
    const stream = { getAudioTracks: () => [] };
    const mediaDevices: any = { getUserMedia: vi.fn(() => Promise.resolve(stream)) };

    watchLocalTracksFromUserMedia(mediaDevices, (t) => seen.push(t));
    await mediaDevices.getUserMedia({ video: true });

    expect(seen).toEqual([]);
  });

  it('never breaks the page when the callback throws', async () => {
    const stream = { getAudioTracks: () => [audioTrack('gum-2')] };
    const mediaDevices: any = { getUserMedia: vi.fn(() => Promise.resolve(stream)) };

    watchLocalTracksFromUserMedia(mediaDevices, () => {
      throw new Error('boom');
    });

    await expect(mediaDevices.getUserMedia({ audio: true })).resolves.toBe(stream);
  });

  it('survives a scope without getUserMedia', () => {
    expect(() => watchLocalTracksFromUserMedia({} as any, () => {})).not.toThrow();
  });
});
