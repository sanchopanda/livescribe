(() => {
  const SOURCE = 'livescribe-pachca-webrtc-tracks';
  const INSTALLED_KEY = '__livescribePachcaWebRTCTracksMainInstalled';
  const REGISTRY_SELECTOR = 'audio[data-livescribe-source="webrtc-registry"]';

  if ((window as any)[INSTALLED_KEY]) {
    return;
  }
  (window as any)[INSTALLED_KEY] = true;

  const OriginalRTCPeerConnection =
    (window as any).RTCPeerConnection || (window as any).webkitRTCPeerConnection;

  if (!OriginalRTCPeerConnection) {
    console.warn('[LiveScribe][Pachca][WebRTCTracksMain] RTCPeerConnection is not available');
    return;
  }

  type TrackMeta = {
    trackId: string;
    streamId: string | null;
    endpointId: string | null;
    createdAt: number;
    /** True for the local microphone — it has no remote endpoint and no participant tile. */
    isLocal: boolean;
  };

  const peerConnections = new Set<RTCPeerConnection>();
  const tracksById = new Map<string, TrackMeta>();

  const extractEndpointFromStreamId = (streamId: string | null): string | null => {
    if (!streamId) return null;
    const match = /^([a-z0-9-]+?)-(?:audio|video)-\d+-\d+$/i.exec(streamId);
    return match?.[1] || null;
  };

  const emitSnapshot = (reason: string): void => {
    const tracks = [...tracksById.values()].map((item) => ({
      trackId: item.trackId,
      streamId: item.streamId,
      endpointId: item.endpointId,
      createdAt: item.createdAt,
      isLocal: item.isLocal,
    }));


    window.postMessage(
      {
        source: SOURCE,
        type: 'snapshot',
        reason,
        tracks,
        timestamp: Date.now(),
      },
      '*',
    );
  };

  const ensureRegistryContainer = (): HTMLElement => {
    const id = 'livescribe-webrtc-track-registry';
    let container = document.getElementById(id);
    if (!container) {
      container = document.createElement('div');
      container.id = id;
      container.style.display = 'none';
      container.setAttribute('aria-hidden', 'true');
      (document.body || document.documentElement).appendChild(container);
    }
    return container;
  };

  const ensureRegistryElement = (
    track: MediaStreamTrack,
    streamId: string | null,
    isLocal = false,
  ): HTMLAudioElement => {
    const container = ensureRegistryContainer();
    const elementId = `livescribe-webrtc-track-${track.id}`;

    let audioEl = document.getElementById(elementId) as HTMLAudioElement | null;
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.id = elementId;
      audioEl.autoplay = false;
      audioEl.muted = true;
      audioEl.setAttribute('data-livescribe-source', 'webrtc-registry');
      container.appendChild(audioEl);
    }

    audioEl.setAttribute('data-track-id', track.id);
    if (isLocal) {
      audioEl.setAttribute('data-local', 'true');
    }
    if (streamId) {
      audioEl.setAttribute('data-stream-id', streamId);
    } else {
      audioEl.removeAttribute('data-stream-id');
    }

    if (!(audioEl.srcObject instanceof MediaStream)) {
      audioEl.srcObject = new MediaStream([track]);
    }

    return audioEl;
  };

  const removeTrack = (trackId: string, reason: string): void => {
    console.log('[LiveScribe][Pachca][WebRTCTracksMain] track removed', { trackId, reason });
    tracksById.delete(trackId);
    const registryElement = document.getElementById(`livescribe-webrtc-track-${trackId}`);
    if (registryElement) {
      registryElement.remove();
    }
    emitSnapshot(reason);
  };

  const addTrack = (event: RTCTrackEvent): void => {
    const track = event.track;
    if (!track || track.kind !== 'audio') return;

    const streamId = event.streams?.[0]?.id || null;
    const endpointId = extractEndpointFromStreamId(streamId);

    tracksById.set(track.id, {
      trackId: track.id,
      streamId,
      endpointId,
      createdAt: Date.now(),
      isLocal: false,
    });

    console.log('[LiveScribe][Pachca][WebRTCTracksMain] track added', {
      trackId: track.id,
      streamId,
      endpointId,
      muted: track.muted,
      readyState: track.readyState,
    });

    ensureRegistryElement(track, streamId);
    emitSnapshot('track-added');

    track.addEventListener('mute', () => {
      console.log('[LiveScribe][Pachca][WebRTCTracksMain] track muted', {
        trackId: track.id,
        streamId,
        endpointId,
      });
      emitSnapshot('track-muted');
    });

    track.addEventListener('unmute', () => {
      console.log('[LiveScribe][Pachca][WebRTCTracksMain] track unmuted', {
        trackId: track.id,
        streamId,
        endpointId,
      });
      emitSnapshot('track-unmuted');
    });

    track.addEventListener('ended', () => removeTrack(track.id, 'track-ended'));
  };

  /**
   * The local microphone. It reaches us from the sending side, so there is no stream id to parse
   * and no participant tile to match — it is marked local and the transcriber labels it as us.
   */
  const addLocalTrack = (track: MediaStreamTrack): void => {
    if (!track || track.kind !== 'audio' || tracksById.has(track.id)) return;

    tracksById.set(track.id, {
      trackId: track.id,
      streamId: null,
      endpointId: 'self',
      createdAt: Date.now(),
      isLocal: true,
    });

    console.log('[LiveScribe][Pachca][WebRTCTracksMain] local track added', {
      trackId: track.id,
      muted: track.muted,
      enabled: track.enabled,
      readyState: track.readyState,
    });

    ensureRegistryElement(track, null, true);
    emitSnapshot('local-track-added');

    track.addEventListener('ended', () => removeTrack(track.id, 'local-track-ended'));
  };

  // Own microphone: `ontrack` fires only for INBOUND tracks, so the mic — attached to a sender —
  // was invisible. Watch the outgoing side instead: getUserMedia (the mic is often acquired before
  // any peer connection exists), addTrack/addTransceiver (attachment) and sender.replaceTrack (the
  // swap many apps perform on unmute).
  //
  // This mirrors `src/content/per-track/core/local-track-hook.ts`, which carries the unit tests.
  // The duplication is deliberate: this script must be a single import-free file, because it has
  // to install synchronously at document_start, before the page constructs its first
  // RTCPeerConnection. A bare import turns it into an async loader and the hook arrives too late
  // (and crxjs collides the two platforms' loaders on their shared basename). Keep both in sync.
  const reportedLocalTracks = new WeakSet<object>();

  const reportLocalTrack = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object') return;
    if ((candidate as MediaStreamTrack).kind !== 'audio') return;
    if (reportedLocalTracks.has(candidate)) return;
    reportedLocalTracks.add(candidate);

    try {
      addLocalTrack(candidate as MediaStreamTrack);
    } catch {
      // Never let our bookkeeping break the call.
    }
  };

  const watchSender = (sender: any): any => {
    if (!sender || typeof sender.replaceTrack !== 'function' || sender.__livescribeWatched) {
      return sender;
    }
    sender.__livescribeWatched = true;

    const originalReplace = sender.replaceTrack.bind(sender);
    sender.replaceTrack = (track: unknown, ...rest: unknown[]) => {
      reportLocalTrack(track);
      return originalReplace(track, ...rest);
    };
    return sender;
  };

  const watchOutgoingAudio = (pc: any): void => {
    if (!pc || pc.__livescribeOutgoingWatched) return;
    pc.__livescribeOutgoingWatched = true;

    if (typeof pc.addTrack === 'function') {
      const originalAddTrack = pc.addTrack.bind(pc);
      pc.addTrack = (track: unknown, ...streams: unknown[]) => {
        reportLocalTrack(track);
        return watchSender(originalAddTrack(track, ...streams));
      };
    }

    if (typeof pc.addTransceiver === 'function') {
      const originalAddTransceiver = pc.addTransceiver.bind(pc);
      // First argument is either a track or a kind string ('audio'/'video').
      pc.addTransceiver = (trackOrKind: unknown, ...rest: unknown[]) => {
        reportLocalTrack(trackOrKind);
        const transceiver = originalAddTransceiver(trackOrKind, ...rest);
        watchSender(transceiver?.sender);
        return transceiver;
      };
    }
  };

  const watchUserMediaAudio = (): void => {
    const devices: any = navigator.mediaDevices;
    if (!devices || typeof devices.getUserMedia !== 'function' || devices.__livescribeWatched) {
      return;
    }
    devices.__livescribeWatched = true;

    const original = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async (constraints?: any) => {
      const stream = await original(constraints);
      try {
        stream.getAudioTracks().forEach(reportLocalTrack);
      } catch {
        // A stream we cannot inspect is still handed back untouched.
      }
      return stream;
    };
  };

  const registerPeerConnection = (pc: RTCPeerConnection): void => {
    peerConnections.add(pc);
    watchOutgoingAudio(pc);
    console.log('[LiveScribe][Pachca][WebRTCTracksMain] peer connection registered', {
      total: peerConnections.size,
    });
    pc.addEventListener('track', addTrack);

    const cleanup = () => {
      peerConnections.delete(pc);
      pc.removeEventListener('track', addTrack);
    };

    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        cleanup();
      }
    });
  };

  function WrappedRTCPeerConnection(...args: ConstructorParameters<typeof RTCPeerConnection>) {
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

  window.setInterval(() => {
    emitSnapshot('heartbeat');
    const registryElements = document.querySelectorAll(REGISTRY_SELECTOR).length;
    console.log('[LiveScribe][Pachca][WebRTCTracksMain] heartbeat', {
      peerConnections: peerConnections.size,
      registryTracks: tracksById.size,
      registryElements,
    });
  }, 5000);

  watchUserMediaAudio();

  console.log('[LiveScribe][Pachca][WebRTCTracksMain] installed');
  emitSnapshot('installed');
})();
