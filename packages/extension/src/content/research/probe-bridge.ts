// ISOLATED-world half of the research probe: asks every frame's MAIN-world probe for its
// WebRTC state, adds the DOM half, and shapes both into a snapshot.

import {
  collectTrackNeedles,
  extractInboundAudio,
  matchAttributes,
  type ElementRecord,
  type FrameReport,
  type Snapshot,
} from './report-builder';

const SOURCE = 'skribo-research-probe';
const COLLECT_TIMEOUT_MS = 1500;

/** Elements scanned when looking for a track↔participant mapping attribute. */
const SCAN_LIMIT = 4000;

const TILE_SELECTORS: Record<string, string> = {
  teams: '[data-cid="calling-participant-stream"]',
  meet: '[data-participant-id]',
  pachca: '[id^="participant_"]',
  zoom: '[class*="participant"]',
};

interface RawFrameReport {
  frameUrl: string;
  isTopFrame: boolean;
  peerConnections: Array<{
    index: number;
    connectionState: string | null;
    iceConnectionState: string | null;
    audioReceivers: number;
    inboundRtp: Array<[string, Record<string, unknown>]>;
    error?: string;
  }>;
}

function normalizeFrame(raw: RawFrameReport): FrameReport {
  return {
    frameUrl: raw.frameUrl,
    isTopFrame: raw.isTopFrame,
    peerConnections: raw.peerConnections.map((pc) => ({
      index: pc.index,
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      audioReceivers: pc.audioReceivers,
      inboundAudio: extractInboundAudio(pc.inboundRtp ?? []),
      ...(pc.error ? { error: pc.error } : {}),
    })),
  };
}

/**
 * Broadcast a collect request and gather whatever answers arrive before the deadline.
 * Frames are not enumerable up front (the probe relays down the tree itself), so this always
 * waits the full timeout rather than counting replies.
 */
function requestFrames(): Promise<{ frames: FrameReport[]; timedOut: boolean }> {
  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const frames: FrameReport[] = [];

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.source !== SOURCE || data.type !== 'report') return;
      if (data.requestId !== requestId) return;
      if (data.frame) frames.push(normalizeFrame(data.frame as RawFrameReport));
    };

    window.addEventListener('message', onMessage);
    window.postMessage({ source: SOURCE, type: 'collect', requestId }, '*');

    window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve({ frames, timedOut: frames.length === 0 });
    }, COLLECT_TIMEOUT_MS);
  });
}

function recordOf(element: Element): ElementRecord {
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) {
    attrs[attr.name] = attr.value;
  }
  return { tag: element.tagName.toLowerCase(), attrs };
}

function collectTiles(platform: string | null): ElementRecord[] {
  const selector = platform ? TILE_SELECTORS[platform] : undefined;
  if (!selector) return [];
  return Array.from(document.querySelectorAll(selector)).map(recordOf);
}

/**
 * Candidates for the attribute scan: elements carrying `data-`, `id` or `aria-` attributes,
 * which is where Meet keeps `data-ssrc` and where a Teams equivalent would live.
 */
function collectScanCandidates(): { records: ElementRecord[]; scanned: number; truncated: boolean } {
  const all = document.querySelectorAll('*');
  const records: ElementRecord[] = [];
  let scanned = 0;

  for (const element of Array.from(all)) {
    if (scanned >= SCAN_LIMIT) {
      return { records, scanned, truncated: true };
    }
    scanned += 1;

    const interesting = Array.from(element.attributes).some(
      (attr) => attr.name.startsWith('data-') || attr.name === 'id' || attr.name.startsWith('aria-'),
    );
    if (interesting) records.push(recordOf(element));
  }

  return { records, scanned, truncated: false };
}

export interface SnapshotContext {
  index: number;
  platform: string | null;
  domSpeaker: { participantId: string; speaker: string | null } | null;
}

export async function collectSnapshot(context: SnapshotContext): Promise<Snapshot> {
  const { frames, timedOut } = await requestFrames();
  const { records, scanned, truncated } = collectScanCandidates();
  const needles = collectTrackNeedles(frames);

  return {
    index: context.index,
    takenAt: new Date().toISOString(),
    platform: context.platform,
    domSpeaker: context.domSpeaker,
    frames,
    tiles: collectTiles(context.platform),
    attributeMatches: matchAttributes(records, needles),
    scan: { scannedElements: scanned, truncated },
    bridgeTimeout: timedOut,
  };
}
