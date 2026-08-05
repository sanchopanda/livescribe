/**
 * Seeing your own microphone in per-track capture.
 *
 * **This module is the tested reference, mirrored inline in the MAIN-world hooks**
 * (`platforms/*​/audio/per-track/webrtc-tracks-main.ts`) rather than imported by them. Those
 * scripts must each stay a single import-free file: they run at `document_start` and have to wrap
 * `RTCPeerConnection` *synchronously*, before the page builds its first one. A bare import makes
 * crxjs emit an async loader instead — the wrapper would land too late, and both platforms' loaders
 * collide on the shared basename `webrtc-tracks-main.js`, leaving neither with its own script.
 * Keep the copies in sync with this file; the tests here are what pin the behaviour.
 *
 * The MAIN-world hook that discovers participants listens to `RTCPeerConnection`'s `track`
 * event, and that event fires **only for inbound tracks**. The local microphone travels the
 * other way — attached to a sender — so it never showed up: your own speech was missing from the
 * transcript and from the audio levels, while everyone else's was there.
 *
 * These helpers watch the outgoing side instead. Two routes, because a page can take either:
 * `getUserMedia` (the moment the mic is acquired, before any peer connection exists) and the
 * peer connection's own `addTrack` / `addTransceiver` / `sender.replaceTrack` (attachment, and
 * the swap that many apps perform on unmute).
 *
 * Everything here wraps page APIs, so it stays defensive: the original call is always made, its
 * return value always passed through untouched, and a throwing callback never reaches the page.
 */

export interface MinimalMediaTrack {
  kind: string;
  id: string;
}

export type LocalAudioTrackListener = (track: MinimalMediaTrack) => void;

interface PeerConnectionLike {
  addTrack?: (...args: any[]) => any;
  addTransceiver?: (...args: any[]) => any;
}

interface MediaDevicesLike {
  getUserMedia?: (constraints?: any) => Promise<{ getAudioTracks: () => MinimalMediaTrack[] }>;
}

const WRAPPED = Symbol('livescribeLocalTrackHook');

function isAudioTrack(value: unknown): value is MinimalMediaTrack {
  return Boolean(value) && typeof value === 'object' && (value as MinimalMediaTrack).kind === 'audio';
}

/**
 * A track can be attached more than once (re-negotiation, a second peer connection). Report each
 * one once so the registry does not churn.
 */
function reporterFor(listener: LocalAudioTrackListener): (track: unknown) => void {
  const reported = new Set<unknown>();

  return (track: unknown) => {
    if (!isAudioTrack(track) || reported.has(track)) return;
    reported.add(track);
    try {
      listener(track);
    } catch {
      // Never let our bookkeeping break the call.
    }
  };
}

/**
 * Watch one peer connection for audio the page sends.
 */
export function watchLocalTracksOnPeerConnection(
  pc: PeerConnectionLike,
  listener: LocalAudioTrackListener,
): void {
  if (!pc || (pc as any)[WRAPPED]) return;
  (pc as any)[WRAPPED] = true;

  const report = reporterFor(listener);

  const watchSender = (sender: any) => {
    if (!sender || typeof sender.replaceTrack !== 'function' || sender[WRAPPED]) return sender;
    sender[WRAPPED] = true;

    const originalReplace = sender.replaceTrack.bind(sender);
    sender.replaceTrack = (track: unknown, ...rest: unknown[]) => {
      report(track);
      return originalReplace(track, ...rest);
    };
    return sender;
  };

  if (typeof pc.addTrack === 'function') {
    const originalAddTrack = pc.addTrack.bind(pc);
    pc.addTrack = (track: unknown, ...streams: unknown[]) => {
      report(track);
      return watchSender(originalAddTrack(track, ...streams));
    };
  }

  if (typeof pc.addTransceiver === 'function') {
    const originalAddTransceiver = pc.addTransceiver.bind(pc);
    // First argument is either a track or a kind string ('audio'/'video') — only the former
    // carries media we can capture.
    pc.addTransceiver = (trackOrKind: unknown, ...rest: unknown[]) => {
      report(trackOrKind);
      const transceiver = originalAddTransceiver(trackOrKind, ...rest);
      watchSender((transceiver as any)?.sender);
      return transceiver;
    };
  }
}

/**
 * Watch the microphone at its source, before it reaches any peer connection.
 */
export function watchLocalTracksFromUserMedia(
  mediaDevices: MediaDevicesLike,
  listener: LocalAudioTrackListener,
): void {
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') return;
  if ((mediaDevices as any)[WRAPPED]) return;
  (mediaDevices as any)[WRAPPED] = true;

  const report = reporterFor(listener);
  const original = mediaDevices.getUserMedia.bind(mediaDevices);

  mediaDevices.getUserMedia = async (constraints?: any) => {
    const stream = await original(constraints);
    try {
      stream.getAudioTracks().forEach(report);
    } catch {
      // A stream that cannot be inspected is still handed back untouched.
    }
    return stream;
  };
}
