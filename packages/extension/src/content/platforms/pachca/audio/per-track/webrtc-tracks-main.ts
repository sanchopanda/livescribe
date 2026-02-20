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

  const ensureRegistryElement = (track: MediaStreamTrack, streamId: string | null): HTMLAudioElement => {
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

  const registerPeerConnection = (pc: RTCPeerConnection): void => {
    peerConnections.add(pc);
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

  console.log('[LiveScribe][Pachca][WebRTCTracksMain] installed');
  emitSnapshot('installed');
})();
