import { describe, expect, it } from 'vitest';
import {
  collectTrackNeedles,
  extractInboundAudio,
  matchAttributes,
  reportFileName,
  summarizeSnapshot,
  type ElementRecord,
  type FrameReport,
  type Snapshot,
} from './report-builder';

function statsOf(entries: Array<Record<string, unknown>>): Map<string, Record<string, unknown>> {
  return new Map(entries.map((entry, index) => [`id-${index}`, entry]));
}

function frameOf(peerConnections: FrameReport['peerConnections']): FrameReport {
  return { frameUrl: 'https://teams.microsoft.com/call', isTopFrame: true, peerConnections };
}

function snapshotOf(frames: FrameReport[]): Snapshot {
  return {
    index: 0,
    takenAt: '2026-07-31T10:00:00.000Z',
    platform: 'teams',
    domSpeaker: null,
    frames,
    tiles: [],
    attributeMatches: [],
    scan: { scannedElements: 0, truncated: false },
    bridgeTimeout: false,
  };
}

describe('extractInboundAudio', () => {
  it('keeps only inbound audio streams', () => {
    const stats = statsOf([
      { type: 'inbound-rtp', kind: 'audio', ssrc: 1043, trackIdentifier: 'track-a', mid: '0', audioLevel: 0.31, totalAudioEnergy: 12.5, packetsReceived: 40122 },
      { type: 'inbound-rtp', kind: 'video', ssrc: 5000 },
      { type: 'outbound-rtp', kind: 'audio', ssrc: 9999 },
      { type: 'candidate-pair', state: 'succeeded' },
    ]);

    expect(extractInboundAudio(stats)).toEqual([
      { ssrc: '1043', trackIdentifier: 'track-a', mid: '0', audioLevel: 0.31, totalAudioEnergy: 12.5, packetsReceived: 40122 },
    ]);
  });

  it('falls back to mediaType when kind is absent', () => {
    const stats = statsOf([{ type: 'inbound-rtp', mediaType: 'audio', ssrc: 7 }]);
    expect(extractInboundAudio(stats)).toHaveLength(1);
  });

  it('reports missing numeric fields as null instead of 0', () => {
    const stats = statsOf([{ type: 'inbound-rtp', kind: 'audio', ssrc: 7 }]);
    const [stat] = extractInboundAudio(stats);
    expect(stat.audioLevel).toBeNull();
    expect(stat.packetsReceived).toBeNull();
    expect(stat.trackIdentifier).toBeNull();
  });
});

describe('matchAttributes', () => {
  const elements: ElementRecord[] = [
    { tag: 'div', attrs: { 'data-ssrc': '1043', class: 'tile' } },
    { tag: 'span', attrs: { 'data-tid': 'unrelated' } },
    { tag: 'div', attrs: { id: 'wrap-track-a-audio' } },
  ];

  it('finds attributes carrying an ssrc or a track id', () => {
    expect(matchAttributes(elements, ['1043', 'track-a'])).toEqual([
      { needle: '1043', tag: 'div', attribute: 'data-ssrc', value: '1043' },
      { needle: 'track-a', tag: 'div', attribute: 'id', value: 'wrap-track-a-audio' },
    ]);
  });

  it('ignores short needles that would match everything', () => {
    expect(matchAttributes(elements, ['1', 'ti'])).toEqual([]);
  });

  it('returns nothing when the platform exposes no mapping', () => {
    expect(matchAttributes([{ tag: 'div', attrs: { class: 'tile' } }], ['1043'])).toEqual([]);
  });
});

describe('collectTrackNeedles', () => {
  it('collects ssrc and track ids across frames without duplicates', () => {
    const frames = [
      frameOf([
        {
          index: 0,
          connectionState: 'connected',
          iceConnectionState: 'connected',
          audioReceivers: 2,
          inboundAudio: [
            { ssrc: '1043', trackIdentifier: 'track-a', mid: '0', audioLevel: 0.3, totalAudioEnergy: 1, packetsReceived: 10 },
            { ssrc: '1043', trackIdentifier: null, mid: '1', audioLevel: 0, totalAudioEnergy: 0, packetsReceived: 5 },
          ],
        },
      ]),
    ];

    expect(collectTrackNeedles(frames)).toEqual(['1043', 'track-a']);
  });
});

describe('summarizeSnapshot', () => {
  it('counts connections, receivers and which streams actually carried voice', () => {
    const snapshot = snapshotOf([
      frameOf([
        {
          index: 0,
          connectionState: 'connected',
          iceConnectionState: 'connected',
          audioReceivers: 2,
          inboundAudio: [
            { ssrc: '1', trackIdentifier: null, mid: null, audioLevel: 0.31, totalAudioEnergy: 2, packetsReceived: 100 },
            { ssrc: '2', trackIdentifier: null, mid: null, audioLevel: 0, totalAudioEnergy: 0, packetsReceived: 90 },
          ],
        },
        {
          index: 1,
          connectionState: 'connected',
          iceConnectionState: 'connected',
          audioReceivers: 1,
          inboundAudio: [
            { ssrc: '3', trackIdentifier: null, mid: null, audioLevel: null, totalAudioEnergy: null, packetsReceived: 1 },
          ],
        },
      ]),
    ]);

    expect(summarizeSnapshot(snapshot)).toEqual({
      peerConnections: 2,
      audioReceivers: 3,
      inboundAudio: 3,
      activeInboundAudio: 1,
    });
  });

  it('handles a snapshot taken before the call started', () => {
    expect(summarizeSnapshot(snapshotOf([frameOf([])]))).toEqual({
      peerConnections: 0,
      audioReceivers: 0,
      inboundAudio: 0,
      activeInboundAudio: 0,
    });
  });
});

describe('reportFileName', () => {
  it('builds a filesystem-safe name', () => {
    expect(reportFileName('teams', '2026-07-31T10:00:00.000Z')).toBe(
      'skribo-research-teams-2026-07-31T10-00-00-000Z.json',
    );
  });

  it('falls back to "unknown" on an unrecognised platform', () => {
    expect(reportFileName(null, '2026-07-31T10:00:00.000Z')).toContain('unknown');
  });
});
