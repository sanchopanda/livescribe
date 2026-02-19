# Speaker Detection Archive (WebRTC + Deepgram Diarization)

This document preserves the previously working experimental implementation so it can be restored end-to-end.

Current production behavior is intentionally **DOM-only speaker assignment**.

---

## 1) What was implemented before

There were two separate experimental layers:

1. **WebRTC loudness speaker detection (extension/Pachca)**
   - Hook `RTCPeerConnection` in page context (`MAIN` world).
   - Poll `getStats()` every 250ms.
   - Read `inbound-rtp` audio `audioLevel`.
   - Map stream/track -> Pachca participant in DOM.
   - Send `SPEAKER_UPDATE` with loudest participant.

2. **Deepgram diarization mapping (backend)**
   - Enable Deepgram `diarize: true`.
   - Parse `words[].speaker` and split one transcript into speaker segments.
   - Convert speaker ids to labels `DG Speaker N`.
   - Map DG labels to recent DOM speaker sequence in backend session window.

---

## 2) Why it was disabled

- WebRTC loudness could misattribute during overlap/interruption.
- A short loud interjection could dominate the current speaker state.
- Streaming diarization labels were unstable for target calls.
- Combined heuristics were complex and still produced wrong speaker attribution.

---

## 3) Files that were removed/changed

### Removed (WebRTC experiment)

- `packages/extension/src/content/pachca-webrtc-main.ts`
- `packages/extension/src/content/pachca-webrtc-speaker-detector.ts`
- `packages/extension/public/pachca-webrtc-hook.js`

### Changed (integration points)

- `packages/extension/src/content/content.ts`
- `packages/extension/public/manifest.json`
- `packages/backend/src/stt/deepgram.ts`
- `packages/backend/src/websocket/handler.ts`

---

## 4) Full restore guide

Follow this in order to fully restore the old behavior.

### Step A. Restore `MAIN`-world early WebRTC hook

Create `packages/extension/src/content/pachca-webrtc-main.ts`:

```ts
(() => {
  const source = 'livescribe-pachca-webrtc';
  const intervalMs = 250;
  const installedKey = '__livescribePachcaWebRTCHookPageInstalled';

  if ((window as any)[installedKey]) return;
  (window as any)[installedKey] = true;

  const OriginalRTCPeerConnection =
    (window as any).RTCPeerConnection || (window as any).webkitRTCPeerConnection;
  if (!OriginalRTCPeerConnection) return;

  const peerConnections = new Set<any>();

  function registerPeerConnection(pc: any): void {
    peerConnections.add(pc);
    const cleanup = () => peerConnections.delete(pc);
    try { pc.addEventListener('close', cleanup); } catch {}
    try {
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'closed' || pc.connectionState === 'failed') cleanup();
      });
    } catch {}
  }

  function WrappedRTCPeerConnection(...args: any[]) {
    const pc = new OriginalRTCPeerConnection(...args);
    registerPeerConnection(pc);
    return pc;
  }

  WrappedRTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
  Object.setPrototypeOf(WrappedRTCPeerConnection, OriginalRTCPeerConnection);

  (window as any).RTCPeerConnection = WrappedRTCPeerConnection;
  if ((window as any).webkitRTCPeerConnection) {
    (window as any).webkitRTCPeerConnection = WrappedRTCPeerConnection;
  }

  window.setInterval(async () => {
    const levels: Array<{ trackId: string; audioLevel: number; timestamp: number }> = [];

    for (const pc of peerConnections) {
      try {
        const stats = await pc.getStats();
        stats.forEach((report: any) => {
          if (report.type !== 'inbound-rtp' || report.kind !== 'audio') return;

          const level = typeof report.audioLevel === 'number' ? report.audioLevel : null;
          if (level === null) return;

          let trackId: string | null = null;
          if (typeof report.trackIdentifier === 'string' && report.trackIdentifier) {
            trackId = report.trackIdentifier;
          }

          if (!trackId && report.trackId) {
            const trackReport = stats.get(report.trackId);
            if (trackReport && typeof trackReport.trackIdentifier === 'string') {
              trackId = trackReport.trackIdentifier;
            }
          }

          if (!trackId) return;
          levels.push({ trackId, audioLevel: level, timestamp: Date.now() });
        });
      } catch {}
    }

    if (levels.length > 0) {
      window.postMessage({ source, levels }, '*');
    }
  }, intervalMs);
})();
```

### Step B. Restore content-side WebRTC detector

Create `packages/extension/src/content/pachca-webrtc-speaker-detector.ts`:

```ts
import type { PachcaSpeakerInfo } from './pachca-speaker-detector';

interface TrackLevel {
  trackId: string;
  audioLevel: number;
  timestamp: number;
}

interface TrackSpeaker {
  participantId: string;
  speaker: string | null;
}

const MESSAGE_SOURCE = 'livescribe-pachca-webrtc';
const INJECT_FLAG = '__livescribePachcaWebRTCHookInjected';
const STATS_INTERVAL_MS = 250;
const LEVEL_STALE_MS = 1500;
const LEVEL_MIN = 0.01;
const WEBRTC_SPEAKER_DEBUG = localStorage.getItem('livescribe-webrtc-speaker-debug') !== '0';

let listenerAttached = false;
const latestTrackLevels = new Map<string, TrackLevel>();

function debugLog(...args: unknown[]): void {
  if (!WEBRTC_SPEAKER_DEBUG) return;
  console.log('[LiveScribe][Pachca][WebRTC]', ...args);
}

function postMessageListener(event: MessageEvent): void {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== MESSAGE_SOURCE || !Array.isArray(data.levels)) return;

  const now = Date.now();
  for (const entry of data.levels) {
    if (!entry || typeof entry.trackId !== 'string' || typeof entry.audioLevel !== 'number') continue;
    latestTrackLevels.set(entry.trackId, {
      trackId: entry.trackId,
      audioLevel: entry.audioLevel,
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : now,
    });
  }
}

function injectWebRTCHook(): void {
  if ((window as any)[INJECT_FLAG]) return;
  (window as any)[INJECT_FLAG] = true;

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('pachca-webrtc-hook.js');
  script.dataset.source = MESSAGE_SOURCE;
  script.dataset.intervalMs = String(STATS_INTERVAL_MS);
  script.async = false;
  script.onload = () => script.remove();
  (document.documentElement || document.head || document.body).appendChild(script);
}

function extractEndpointIdFromParticipantId(participantId: string): string {
  const match = /^participant_(.+)$/i.exec(participantId.trim());
  return match?.[1] || participantId;
}

function extractEndpointIdFromStreamId(streamId?: string | null): string | null {
  if (!streamId) return null;
  const match = /^([a-z0-9-]+?)-(?:audio|video)-\d+-\d+$/i.exec(streamId);
  return match?.[1] || null;
}

function collectTrackSpeakerMap(): Map<string, TrackSpeaker> {
  const map = new Map<string, TrackSpeaker>();
  const endpointToSpeaker = new Map<string, TrackSpeaker>();
  const tiles = document.querySelectorAll<HTMLElement>('.filmstrip__videos [id^="participant_"]');

  tiles.forEach((tile) => {
    const participantId = tile.id || 'unknownParticipant';
    const speaker =
      document.getElementById(`${participantId}_name`)?.textContent?.trim() ||
      tile.querySelector<HTMLElement>('.displayname')?.textContent?.trim() ||
      null;

    const endpointId = extractEndpointIdFromParticipantId(participantId);
    endpointToSpeaker.set(endpointId, { participantId, speaker });

    tile.querySelectorAll<HTMLMediaElement>('video, audio').forEach((mediaEl) => {
      const stream = mediaEl.srcObject;
      if (!(stream instanceof MediaStream)) return;
      stream.getAudioTracks().forEach((track) => {
        if (track?.id) map.set(track.id, { participantId, speaker });
      });
    });
  });

  document.querySelectorAll<HTMLMediaElement>('video, audio').forEach((mediaEl) => {
    const stream = mediaEl.srcObject;
    if (!(stream instanceof MediaStream)) return;
    const endpointId = extractEndpointIdFromStreamId(stream.id);
    if (!endpointId) return;

    const endpointSpeaker = endpointToSpeaker.get(endpointId);
    if (!endpointSpeaker) return;

    stream.getAudioTracks().forEach((track) => {
      if (track?.id) map.set(track.id, endpointSpeaker);
    });
  });

  return map;
}

export function startPachcaWebRTCSpeakerDetection(): void {
  injectWebRTCHook();
  if (listenerAttached) return;
  window.addEventListener('message', postMessageListener);
  listenerAttached = true;
}

export function stopPachcaWebRTCSpeakerDetection(): void {
  if (!listenerAttached) return;
  window.removeEventListener('message', postMessageListener);
  listenerAttached = false;
  latestTrackLevels.clear();
}

export function getPachcaWebRTCSpeakerCandidate(): PachcaSpeakerInfo | null {
  const now = Date.now();
  const trackMap = collectTrackSpeakerMap();

  let best: { trackId: string; level: number; speaker: TrackSpeaker } | null = null;
  for (const [trackId, level] of latestTrackLevels) {
    if (now - level.timestamp > LEVEL_STALE_MS) continue;
    if (level.audioLevel < LEVEL_MIN) continue;
    const speaker = trackMap.get(trackId);
    if (!speaker) continue;
    if (!best || level.audioLevel > best.level) {
      best = { trackId, level: level.audioLevel, speaker };
    }
  }

  if (!best) return null;

  debugLog('speaker candidate', {
    participantId: best.speaker.participantId,
    speaker: best.speaker.speaker,
    trackId: best.trackId,
    audioLevel: Number(best.level.toFixed(4)),
  });

  return {
    participantId: best.speaker.participantId,
    speaker: best.speaker.speaker,
  };
}
```

### Step C. Restore optional public hook file

Create `packages/extension/public/pachca-webrtc-hook.js` (fallback hook from content injection):

```js
(() => {
  const source = 'livescribe-pachca-webrtc';
  const installedKey = '__livescribePachcaWebRTCHookPageInstalled';
  if (window[installedKey]) return;
  window[installedKey] = true;
  // (same idea as MAIN hook: patch RTCPeerConnection and post levels)
})();
```

> If `MAIN` hook is active and stable, this file can remain a fallback only.

### Step D. Restore extension manifest wiring

In `packages/extension/public/manifest.json`:

1. Add `MAIN` world early script for Pachca:

```json
{
  "matches": ["https://*.pachca.com/*", "https://app.pachca.com/*"],
  "js": ["src/content/pachca-webrtc-main.js"],
  "run_at": "document_start",
  "all_frames": false,
  "world": "MAIN"
}
```

2. Add `pachca-webrtc-hook.js` to `web_accessible_resources` if used:

```json
"resources": ["processor.worklet.js", "pachca-webrtc-hook.js"]
```

### Step E. Reconnect `content.ts`

In `packages/extension/src/content/content.ts`:

```ts
import {
  getPachcaWebRTCSpeakerCandidate,
  startPachcaWebRTCSpeakerDetection,
  stopPachcaWebRTCSpeakerDetection,
} from './pachca-webrtc-speaker-detector';
```

In speaker tracking:

```ts
if (window.location.hostname.includes('pachca.com')) {
  startPachcaWebRTCSpeakerDetection();
}

if (host.includes('pachca.com')) {
  info = getPachcaWebRTCSpeakerCandidate() ?? getPachcaActiveSpeaker();
}

stopPachcaWebRTCSpeakerDetection();
```

---

## 5) Deepgram diarization restore guide

### Step A. Re-enable diarization in `deepgram.ts`

In `packages/backend/src/stt/deepgram.ts`, set:

```ts
diarize: true,
```

### Step B. Re-add speaker split logic

Restore helper types/methods:

```ts
interface DeepgramWord { word?: string; confidence?: number; speaker?: number; }
interface DeepgramSpeakerSegment { speaker?: string; text: string; confidence?: number; }

private formatSpeakerLabel(speakerId: number): string {
  return `DG Speaker ${speakerId + 1}`;
}

private splitBySpeaker(words: DeepgramWord[]): DeepgramSpeakerSegment[] { /* ... */ }
```

And in result processing:

- Parse `const words: DeepgramWord[] = alternative?.words || []`.
- Build `speakerSegments = this.splitBySpeaker(words)`.
- If many segments, emit callback per segment with `speaker: segment.speaker`.

### Step C. Restore backend DG->DOM mapping window in `handler.ts`

Restore session-local mapping helpers:

```ts
const speakerEvents: Array<{ speaker: string; timestamp: number }> = [];
const activeDiarizeLabels: string[] = [];

const isDeepgramSpeakerLabel = (speaker?: string) => /^DG Speaker\s+\d+$/i.test((speaker || '').trim());
```

Add resolver:

```ts
const resolveDiarizedSpeakerToWindow = (dgSpeaker?: string, fallbackSpeaker?: string | null): string | undefined => {
  // windowed ordering reconciliation
};
```

Apply in `onResult`:

```ts
const resolvedSpeaker = isDeepgramSpeakerLabel(result.speaker)
  ? resolveDiarizedSpeakerToWindow(result.speaker, session?.speaker)
  : result.speaker ?? session?.speaker ?? undefined;
```

---

## 6) Validation checklist after restore

1. Build extension and reload unpacked extension.
2. Confirm `window.__livescribePachcaWebRTCHookPageInstalled === true` on Pachca call.
3. Confirm `window.postMessage` events with `source = livescribe-pachca-webrtc` are arriving.
4. Verify `[LiveScribe][Pachca][WebRTC] speaker candidate` logs appear and switch with real speakers.
5. Verify backend transcript speaker field switches accordingly.
6. For diarization path, inspect Deepgram payload `words[].speaker` and segment emission.
7. Run long-call regression with interruptions and overlap.

---

## 7) Current production path (reference)

- Extension detects current speaker from DOM detectors (`pachca`/`teams`) only.
- Backend uses session DOM speaker (`session.speaker`) for transcript speaker attribution.
- No runtime WebRTC loudness-based assignment.
- No runtime Deepgram diarization mapping.

