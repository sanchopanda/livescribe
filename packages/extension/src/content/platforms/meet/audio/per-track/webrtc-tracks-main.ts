(() => {
  const SOURCE = 'livescribe-meet-webrtc-tracks';
  const INSTALLED_KEY = '__livescribeMeetWebRTCTracksMainInstalled';
  const REGISTRY_SELECTOR = 'audio[data-livescribe-source="webrtc-registry"]';

  if ((window as any)[INSTALLED_KEY]) {
    return;
  }
  (window as any)[INSTALLED_KEY] = true;

  const OriginalRTCPeerConnection =
    (window as any).RTCPeerConnection || (window as any).webkitRTCPeerConnection;

  if (!OriginalRTCPeerConnection) {
    console.warn('[LiveScribe][Meet][WebRTCTracksMain] RTCPeerConnection is not available');
    return;
  }

  type TrackMeta = {
    trackId: string;
    streamId: string | null;
    ssrc: string | null;
    createdAt: number;
  };

  const peerConnections = new Set<RTCPeerConnection>();
  const tracksById = new Map<string, TrackMeta>();

  const emitSnapshot = (reason: string): void => {
    const tracks = [...tracksById.values()].map((item) => ({
      trackId: item.trackId,
      streamId: item.streamId,
      ssrc: item.ssrc,
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
    const id = 'livescribe-meet-webrtc-track-registry';
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

  const updateRegistryElementSsrc = (trackId: string, ssrc: string): void => {
    const el = document.getElementById(`livescribe-webrtc-track-${trackId}`);
    if (el) {
      el.setAttribute('data-ssrc', ssrc);
    }
    const meta = tracksById.get(trackId);
    if (meta) {
      meta.ssrc = ssrc;
    }
  };

  const removeTrack = (trackId: string, reason: string): void => {
    console.log('[LiveScribe][Meet][WebRTCTracksMain] track removed', { trackId, reason });
    tracksById.delete(trackId);
    const registryElement = document.getElementById(`livescribe-webrtc-track-${trackId}`);
    if (registryElement) {
      registryElement.remove();
    }
    emitSnapshot(reason);
  };

  const extractSsrcFromReceiver = (receiver: RTCRtpReceiver, trackId: string): void => {
    receiver
      .getStats()
      .then((stats) => {
        stats.forEach((report: any) => {
          if (report.type === 'inbound-rtp' && report.kind === 'audio' && report.ssrc) {
            const ssrc = String(report.ssrc);
            updateRegistryElementSsrc(trackId, ssrc);
            emitSnapshot('ssrc-discovered');
            console.log('[LiveScribe][Meet][WebRTCTracksMain] SSRC discovered', { trackId, ssrc });
          }
        });
      })
      .catch(() => {
        // getStats may fail if connection is already closed
      });
  };

  const addTrack = (event: RTCTrackEvent): void => {
    const track = event.track;
    if (!track || track.kind !== 'audio') return;

    const streamId = event.streams?.[0]?.id || null;

    tracksById.set(track.id, {
      trackId: track.id,
      streamId,
      ssrc: null,
      createdAt: Date.now(),
    });

    console.log('[LiveScribe][Meet][WebRTCTracksMain] track added', {
      trackId: track.id,
      streamId,
      muted: track.muted,
      readyState: track.readyState,
    });

    ensureRegistryElement(track, streamId);
    emitSnapshot('track-added');

    // Async SSRC extraction from receiver stats
    if (event.receiver) {
      extractSsrcFromReceiver(event.receiver, track.id);
    }

    track.addEventListener('mute', () => {
      console.log('[LiveScribe][Meet][WebRTCTracksMain] track muted', { trackId: track.id, streamId });
      emitSnapshot('track-muted');
    });

    track.addEventListener('unmute', () => {
      console.log('[LiveScribe][Meet][WebRTCTracksMain] track unmuted', { trackId: track.id, streamId });
      emitSnapshot('track-unmuted');
    });

    track.addEventListener('ended', () => removeTrack(track.id, 'track-ended'));
  };

  const registerPeerConnection = (pc: RTCPeerConnection): void => {
    peerConnections.add(pc);
    console.log('[LiveScribe][Meet][WebRTCTracksMain] peer connection registered', {
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
    console.log('[LiveScribe][Meet][WebRTCTracksMain] heartbeat', {
      peerConnections: peerConnections.size,
      registryTracks: tracksById.size,
      registryElements,
    });
  }, 5000);

  console.log('[LiveScribe][Meet][WebRTCTracksMain] installed');
  emitSnapshot('installed');
})();
