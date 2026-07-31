/**
 * MAIN-world research probe (dev builds only).
 *
 * Wraps RTCPeerConnection so we can see how a platform delivers remote audio: one mixed
 * stream, or one per participant. It only observes — no interception, no capture, nothing
 * leaves the page except the report the widget asks for.
 *
 * Must run at document_start: the wrapper has to be in place before the page opens its
 * connections. Kept dependency-free on purpose — MAIN-world content scripts are injected as
 * classic scripts, so this file must bundle to a self-contained IIFE.
 */
(() => {
  const SOURCE = 'skribo-research-probe';
  const INSTALLED_KEY = '__skriboResearchProbeInstalled';

  if ((window as any)[INSTALLED_KEY]) return;
  (window as any)[INSTALLED_KEY] = true;

  const OriginalRTCPeerConnection =
    (window as any).RTCPeerConnection || (window as any).webkitRTCPeerConnection;

  if (!OriginalRTCPeerConnection) {
    console.warn('[Skribo][probe] RTCPeerConnection is not available in this frame');
    return;
  }

  interface TrackEvent {
    trackId: string;
    kind: string;
    streamIds: string[];
    at: number;
  }

  const connections: Array<{ pc: RTCPeerConnection; createdAt: number; trackEvents: TrackEvent[] }> = [];
  const handledRequests = new Set<string>();

  const WrappedRTCPeerConnection = function (this: unknown, ...args: unknown[]) {
    const pc = new OriginalRTCPeerConnection(...args);
    const record = { pc, createdAt: Date.now(), trackEvents: [] as TrackEvent[] };
    connections.push(record);

    pc.addEventListener('track', (event: RTCTrackEvent) => {
      record.trackEvents.push({
        trackId: event.track.id,
        kind: event.track.kind,
        streamIds: event.streams.map((stream) => stream.id),
        at: Date.now(),
      });
    });

    return pc;
  } as unknown as typeof RTCPeerConnection;

  WrappedRTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
  (window as any).RTCPeerConnection = WrappedRTCPeerConnection;
  if ((window as any).webkitRTCPeerConnection) {
    (window as any).webkitRTCPeerConnection = WrappedRTCPeerConnection;
  }

  async function describeConnection(
    record: { pc: RTCPeerConnection; createdAt: number; trackEvents: TrackEvent[] },
    index: number,
  ) {
    const base = {
      index,
      createdAt: record.createdAt,
      connectionState: record.pc.connectionState ?? null,
      iceConnectionState: record.pc.iceConnectionState ?? null,
      trackEvents: record.trackEvents,
    };

    let audioReceivers = 0;
    try {
      audioReceivers = record.pc.getReceivers().filter((r) => r.track?.kind === 'audio').length;
    } catch {
      // getReceivers throws on a closed connection — the rest of the report is still useful.
    }

    try {
      const stats = await record.pc.getStats();
      // Only inbound-rtp is forwarded; a full stats dump is mostly codecs and candidate pairs.
      const inboundRtp: Array<[string, Record<string, unknown>]> = [];
      stats.forEach((entry: Record<string, unknown>, id: string) => {
        if (entry?.type === 'inbound-rtp') inboundRtp.push([id, { ...entry }]);
      });
      return { ...base, audioReceivers, inboundRtp };
    } catch (err) {
      return {
        ...base,
        audioReceivers,
        inboundRtp: [] as Array<[string, Record<string, unknown>]>,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async function reportTo(requestId: string): Promise<void> {
    const peerConnections = await Promise.all(connections.map(describeConnection));

    const payload = {
      source: SOURCE,
      type: 'report',
      requestId,
      frame: {
        frameUrl: window.location.href,
        isTopFrame: window.top === window,
        peerConnections,
      },
    };

    try {
      (window.top ?? window).postMessage(payload, '*');
    } catch {
      window.postMessage(payload, '*');
    }
  }

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.source !== SOURCE || data.type !== 'collect') return;

    const requestId = String(data.requestId ?? '');
    if (!requestId || handledRequests.has(requestId)) return;
    handledRequests.add(requestId);

    // Relay down the frame tree so nested iframes report too, then answer for this frame.
    for (let i = 0; i < window.frames.length; i += 1) {
      try {
        window.frames[i].postMessage(data, '*');
      } catch {
        // cross-origin frame that refuses the post — nothing to do about it
      }
    }

    void reportTo(requestId);
  });

  console.log('[Skribo][probe] installed', window.location.href);
})();
