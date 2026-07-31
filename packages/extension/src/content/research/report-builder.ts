// Pure shaping of the research report. Everything DOM- or WebRTC-specific is collected
// elsewhere and handed in as plain objects, so this stays testable without a browser.

export interface InboundAudioStat {
  ssrc: string | null;
  trackIdentifier: string | null;
  mid: string | null;
  audioLevel: number | null;
  totalAudioEnergy: number | null;
  packetsReceived: number | null;
}

export interface PeerConnectionReport {
  index: number;
  connectionState: string | null;
  iceConnectionState: string | null;
  audioReceivers: number;
  inboundAudio: InboundAudioStat[];
  error?: string;
}

export interface FrameReport {
  frameUrl: string;
  isTopFrame: boolean;
  peerConnections: PeerConnectionReport[];
}

export interface ElementRecord {
  tag: string;
  attrs: Record<string, string>;
}

export interface AttributeMatch {
  needle: string;
  tag: string;
  attribute: string;
  value: string;
}

export interface Snapshot {
  index: number;
  takenAt: string;
  platform: string | null;
  domSpeaker: { participantId: string; speaker: string | null } | null;
  frames: FrameReport[];
  tiles: ElementRecord[];
  attributeMatches: AttributeMatch[];
  /** How wide the attribute scan actually went — a truncated scan must not read as "no match". */
  scan: { scannedElements: number; truncated: boolean };
  bridgeTimeout: boolean;
}

export interface SnapshotSummary {
  peerConnections: number;
  audioReceivers: number;
  inboundAudio: number;
  activeInboundAudio: number;
}

/** An `RTCStatsReport` is a Map-like; tests pass a plain Map with the same shape. */
export type StatsLike = Iterable<[string, Record<string, unknown>]>;

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/** Pick the inbound audio streams out of a stats report — the go/no-go signal for per-track. */
export function extractInboundAudio(stats: StatsLike): InboundAudioStat[] {
  const result: InboundAudioStat[] = [];

  for (const [, entry] of stats) {
    if (entry?.type !== 'inbound-rtp') continue;
    // `kind` is the modern field; older Chrome reports only `mediaType`.
    const kind = entry.kind ?? entry.mediaType;
    if (kind !== 'audio') continue;

    result.push({
      ssrc: stringOrNull(entry.ssrc),
      trackIdentifier: stringOrNull(entry.trackIdentifier),
      mid: stringOrNull(entry.mid),
      audioLevel: numberOrNull(entry.audioLevel),
      totalAudioEnergy: numberOrNull(entry.totalAudioEnergy),
      packetsReceived: numberOrNull(entry.packetsReceived),
    });
  }

  return result;
}

/**
 * Find DOM attributes carrying a track identifier or ssrc — this is what Meet exposes as
 * `data-ssrc` and what a Teams per-track pipeline would need an equivalent of.
 */
export function matchAttributes(elements: ElementRecord[], needles: string[]): AttributeMatch[] {
  const wanted = needles.filter((needle) => needle && needle.length >= 4);
  if (wanted.length === 0) return [];

  const matches: AttributeMatch[] = [];
  for (const element of elements) {
    for (const [attribute, value] of Object.entries(element.attrs)) {
      if (!value) continue;
      for (const needle of wanted) {
        if (value.includes(needle)) {
          matches.push({ needle, tag: element.tag, attribute, value });
        }
      }
    }
  }
  return matches;
}

/** Every ssrc and track id seen in a set of frames — the needles for `matchAttributes`. */
export function collectTrackNeedles(frames: FrameReport[]): string[] {
  const needles = new Set<string>();
  for (const frame of frames) {
    for (const pc of frame.peerConnections) {
      for (const stat of pc.inboundAudio) {
        if (stat.ssrc) needles.add(stat.ssrc);
        if (stat.trackIdentifier) needles.add(stat.trackIdentifier);
      }
    }
  }
  return [...needles];
}

/** Counters for the widget line: "PC: 2 · audio-in: 3 (1 активен)". */
export function summarizeSnapshot(snapshot: Snapshot): SnapshotSummary {
  let peerConnections = 0;
  let audioReceivers = 0;
  let inboundAudio = 0;
  let activeInboundAudio = 0;

  for (const frame of snapshot.frames) {
    peerConnections += frame.peerConnections.length;
    for (const pc of frame.peerConnections) {
      audioReceivers += pc.audioReceivers;
      inboundAudio += pc.inboundAudio.length;
      // Silence sits at exactly 0; anything above means this stream carried voice.
      activeInboundAudio += pc.inboundAudio.filter((s) => (s.audioLevel ?? 0) > 0).length;
    }
  }

  return { peerConnections, audioReceivers, inboundAudio, activeInboundAudio };
}

export interface Report {
  version: 1;
  platform: string | null;
  pageUrl: string;
  snapshots: Snapshot[];
}

export function buildReport(platform: string | null, pageUrl: string, snapshots: Snapshot[]): Report {
  return { version: 1, platform, pageUrl, snapshots };
}

export function reportFileName(platform: string | null, takenAt: string): string {
  const stamp = takenAt.replace(/[:.]/g, '-');
  return `skribo-research-${platform ?? 'unknown'}-${stamp}.json`;
}
