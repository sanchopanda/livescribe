// Background service worker for LiveScribe extension
// Coordinates between popup and offscreen document

import { AUTH_INVALID_TOKEN } from '@skribo/shared';
import { getPlatformCapabilities, resolveAudioMode } from '../platform/audio-mode-capabilities';
import {
  TOGGLE_WIDGET_IN_ACTIVE_TAB,
  type WidgetToggleResult,
} from '../messaging/widget-messages';
import {
  buildCallKey,
  resolveResumeMeetingId,
  type RememberedMeeting,
} from './meeting-continuity';

declare const __API_URL__: string;

console.log('LiveScribe background service worker initialized');

type RecordingState = 'idle' | 'recording' | 'error';
type WsState = 'connected' | 'disconnected' | 'error';

// State
let recordingState: RecordingState = 'idle';
let wsState: WsState = 'disconnected';
let sessionId: string | null = null;
/**
 * Meeting the current recording writes into. Survives a WebSocket drop so the reconnect can
 * resume that meeting rather than start a second one for the same call.
 */
let activeMeetingId: string | null = null;
/** Identity of the call being recorded (see `buildCallKey`) — the key a pause resumes against. */
let activeCallKey: string | null = null;
let offscreenCreated = false;
let recordingTabId: number | null = null;
let recordingSegmentStartedAtMs: number | null = null;
let recordingAccumulatedMs = 0;
let deepgramAudioSentMs = 0;
let currentAudioMode: 'mixed' | 'per-track' = 'mixed';
let activeRecordingStartMessage: {
  language?: string;
  platform?: string;
  audioMode?: 'mixed' | 'per-track';
} | null = null;
let perTrackRecoveryInProgress = false;

interface TrackSpeakerLevel {
  participantId: string;
  speaker: string | null;
  rms: number;
  peak: number;
  timestamp: number;
}

let mixedAudioLevel: { rms: number; peak: number; timestamp: number } | null = null;
const perTrackAudioLevels = new Map<string, TrackSpeakerLevel>();

const AUDIO_LEVELS_TTL_MS = 3000;
const AUDIO_LEVELS_EMA_ALPHA = 0.25;
const AUDIO_LEVELS_MAX_SPEAKERS = 8;

function getUiStatus(): RecordingState {
  return recordingState;
}

function setRecordingState(nextState: RecordingState, reason: string): void {
  const previousState = recordingState;
  recordingState = nextState;
  if (previousState !== nextState) {
    console.log(`[RecordingState] ${previousState} -> ${nextState}`, { reason });
  }
}

function setRecordingActive(reason: string): void {
  setRecordingState('recording', reason);
}

function setRecordingIdle(options?: {
  reason?: string;
  clearSession?: boolean;
  pauseMetrics?: boolean;
  resetLevels?: boolean;
  broadcastMetrics?: boolean;
  broadcastLevels?: boolean;
}): void {
  const reason = options?.reason || 'setRecordingIdle';
  if (options?.pauseMetrics !== false) {
    pauseAudioMetrics();
  }
  if (options?.clearSession !== false) {
    sessionId = null;
    // Forget the live meeting but keep the remembered one: pressing start again inside the same
    // call should continue it, and the pause is measured from this moment.
    activeMeetingId = null;
    touchRememberedMeeting().catch(() => {});
  }
  if (options?.resetLevels !== false) {
    resetAudioLevels();
  }
  if (options?.broadcastMetrics !== false) {
    broadcastAudioMetrics();
  }
  if (options?.broadcastLevels !== false) {
    broadcastAudioLevels();
  }
  setRecordingState('idle', reason);
}

function setWsState(nextState: WsState, reason: string): void {
  const previousState = wsState;
  wsState = nextState;
  if (previousState !== nextState) {
    console.log(`[WsState] ${previousState} -> ${nextState}`, { reason });
  }
}

function setWsStateConnected(reason: string): void {
  setWsState('connected', reason);
}

function setWsStateDisconnected(reason: string): void {
  setWsState('disconnected', reason);
}

function setWsStateError(reason: string): void {
  setWsState('error', reason);
}

function resetAudioMetrics(options?: { keepRunning?: boolean }): void {
  const keepRunning = options?.keepRunning === true;
  recordingAccumulatedMs = 0;
  deepgramAudioSentMs = 0;
  if (keepRunning && recordingState === 'recording') {
    recordingSegmentStartedAtMs = Date.now();
  } else {
    recordingSegmentStartedAtMs = null;
  }
}

function beginAudioMetrics(): void {
  if (recordingSegmentStartedAtMs === null) {
    recordingSegmentStartedAtMs = Date.now();
  }
}

function pauseAudioMetrics(): void {
  if (recordingSegmentStartedAtMs === null) return;
  recordingAccumulatedMs += Math.max(0, Date.now() - recordingSegmentStartedAtMs);
  recordingSegmentStartedAtMs = null;
}

function getAudioMetricsSnapshot() {
  const currentSegmentMs =
    recordingSegmentStartedAtMs !== null ? Math.max(0, Date.now() - recordingSegmentStartedAtMs) : 0;
  const recordingTotalMs = recordingAccumulatedMs + currentSegmentMs;

  return {
    recordingStartedAtMs: recordingSegmentStartedAtMs,
    recordingSeconds: Math.max(0, Math.floor(recordingTotalMs / 1000)),
    deepgramSeconds: Math.max(0, Math.floor(deepgramAudioSentMs / 1000)),
  };
}

function forwardToContentScript(message: object): void {
  const sendToTab = (tabId: number) => {
    chrome.tabs.sendMessage(tabId, message).catch(() => {
      // Content script might not be ready, that's ok.
    });
  };

  if (recordingTabId !== null) {
    sendToTab(recordingTabId);
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      sendToTab(tabs[0].id);
    }
  });
}

function broadcastAudioMetrics(): void {
  forwardToContentScript({ type: 'CONTENT_AUDIO_METRICS', ...getAudioMetricsSnapshot() });
}

function resetAudioLevels(): void {
  mixedAudioLevel = null;
  perTrackAudioLevels.clear();
}

function normalizeLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function buildAudioLevelsSnapshot() {
  const now = Date.now();

  for (const [participantId, entry] of perTrackAudioLevels.entries()) {
    if (now - entry.timestamp > AUDIO_LEVELS_TTL_MS) {
      perTrackAudioLevels.delete(participantId);
    }
  }

  const speakers = [...perTrackAudioLevels.values()]
    .sort((first, second) => second.rms - first.rms)
    .slice(0, AUDIO_LEVELS_MAX_SPEAKERS)
    .map((entry) => ({
      participantId: entry.participantId,
      speaker: entry.speaker,
      rms: entry.rms,
      peak: entry.peak,
      timestamp: entry.timestamp,
    }));

  return {
    mode: currentAudioMode,
    mixed: mixedAudioLevel,
    speakers,
  };
}

function broadcastAudioLevels(): void {
  const snapshot = buildAudioLevelsSnapshot();
  forwardToContentScript({
    type: 'CONTENT_AUDIO_LEVELS',
    mode: snapshot.mode,
    mixed: snapshot.mixed,
    speakers: snapshot.speakers,
  });
}

function broadcastWsRecoveryStatus(reason?: string): void {
  forwardToContentScript({
    type: 'CONTENT_WS_RECOVERY_STATUS',
    recovering: perTrackRecoveryInProgress,
    reason: reason || null,
  });
}

// Create offscreen document
async function ensureOffscreen() {
  if (offscreenCreated) return;

  try {
    // Check if offscreen document already exists
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });

    if (existingContexts.length > 0) {
      offscreenCreated = true;
      return;
    }

    // Create offscreen document
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'WebSocket session and media processing for transcription',
    });

    offscreenCreated = true;
    console.log('Offscreen document created');
  } catch (err) {
    console.error('Failed to create offscreen document:', err);
    throw err;
  }
}

// Send message to offscreen document
async function sendToOffscreen(message: object): Promise<any> {
  await ensureOffscreen();
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (err: any) {
    // If offscreen document was closed, reset flag
    if (err.message?.includes('Receiving end does not exist')) {
      console.log('Offscreen document was closed, resetting flag');
      offscreenCreated = false;
      // Try one more time after resetting
      await ensureOffscreen();
      return await chrome.runtime.sendMessage(message);
    }
    throw err;
  }
}

const REMEMBERED_MEETING_KEY = 'skriboRememberedMeeting';

/**
 * Remember which meeting the recording in this tab belongs to. Stored in session storage
 * because the MV3 service worker is torn down between events and would otherwise forget the
 * meeting mid-call, splitting it in the cabinet.
 */
async function rememberMeeting(meetingId: string): Promise<void> {
  if (!activeCallKey) return;
  const entry: RememberedMeeting = { meetingId, callKey: activeCallKey, lastActiveAtMs: Date.now() };
  try {
    await chrome.storage.session.set({ [REMEMBERED_MEETING_KEY]: entry });
  } catch (err) {
    console.warn('Failed to remember meeting', err);
  }
}

/** Push the pause clock forward — the continuity window counts from the last live moment. */
async function touchRememberedMeeting(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(REMEMBERED_MEETING_KEY);
    const entry = stored?.[REMEMBERED_MEETING_KEY] as RememberedMeeting | undefined;
    if (!entry) return;
    await chrome.storage.session.set({
      [REMEMBERED_MEETING_KEY]: { ...entry, lastActiveAtMs: Date.now() },
    });
  } catch (err) {
    console.warn('Failed to touch remembered meeting', err);
  }
}

/**
 * Meeting a session starting now should continue: the live one after a dropped socket, or the
 * one this tab was recording before the user paused.
 */
async function resumeMeetingIdForStart(): Promise<string | undefined> {
  if (activeMeetingId) return activeMeetingId;

  try {
    const stored = await chrome.storage.session.get(REMEMBERED_MEETING_KEY);
    const entry = stored?.[REMEMBERED_MEETING_KEY] as RememberedMeeting | undefined;
    const resumeId = resolveResumeMeetingId(entry, activeCallKey, Date.now());
    return resumeId ?? undefined;
  } catch (err) {
    console.warn('Failed to read remembered meeting', err);
    return undefined;
  }
}

async function getSkriboToken(): Promise<string | undefined> {
  const { skriboToken } = await chrome.storage.local.get('skriboToken');
  const t = typeof skriboToken === 'string' ? skriboToken.trim() : '';
  return t || undefined;
}

async function recoverPerTrackSession(reason: string): Promise<void> {
  if (perTrackRecoveryInProgress) return;
  if (currentAudioMode !== 'per-track' || !activeRecordingStartMessage) return;

  perTrackRecoveryInProgress = true;
  broadcastWsRecoveryStatus(reason);
  try {
    console.warn('Attempting per-track WS/session recovery', {
      reason,
      sessionId,
      recordingState,
      wsState,
      recordingTabId,
    });

    const connectResponse = await sendToOffscreen({ type: 'OFFSCREEN_CONNECT' });
    if (connectResponse?.error) {
      throw new Error(connectResponse.error);
    }

    const startResponse = await sendToOffscreen({
      type: 'OFFSCREEN_START_SESSION',
      language: activeRecordingStartMessage.language || 'ru-RU',
      platform: activeRecordingStartMessage.platform,
      audioMode: 'per-track',
      token: await getSkriboToken(),
      resumeMeetingId: await resumeMeetingIdForStart(),
    });

    if (startResponse?.error) {
      throw new Error(startResponse.error);
    }

    setWsStateConnected('recoverPerTrackSession:session-started');
    setRecordingActive('recoverPerTrackSession:session-started');
    beginAudioMetrics();
    console.warn('Per-track WS/session recovery completed');
  } catch (err) {
    console.error('Per-track WS/session recovery failed:', err);
  } finally {
    perTrackRecoveryInProgress = false;
    broadcastWsRecoveryStatus();
  }
}

// Helper function for offscreen recording
function startRecordingOffscreen(message: any, sendResponse: (response: any) => void) {
  const platformCapabilities = getPlatformCapabilities(message.platform);
  const audioMode = resolveAudioMode(message.audioMode, message.platform);
  currentAudioMode = audioMode;
  resetAudioLevels();
  broadcastAudioLevels();
  const shouldSkipTabCapture =
    platformCapabilities.supportsPerTrackAudioMode && audioMode === 'per-track';

  console.log('startRecordingOffscreen mode', {
    platform: message.platform,
    audioMode,
    shouldSkipTabCapture,
    supportsPerTrackAudioMode: platformCapabilities.supportsPerTrackAudioMode,
    supportsMixedCapture: platformCapabilities.supportsMixedCapture,
    hasProvidedStreamId: Boolean(message.streamId),
  });

  const startCaptureWithActiveStreamRecovery = (streamId: string) => {
    sendToOffscreen({ type: 'OFFSCREEN_START_CAPTURE', streamId })
      .then((response) => {
        const errorMessage = response?.error || '';
        const isActiveStreamError =
          typeof errorMessage === 'string' && errorMessage.toLowerCase().includes('active stream');

        if (!isActiveStreamError) {
          if (!response.error) {
            setRecordingActive('startRecordingOffscreen:start-capture');
            beginAudioMetrics();
            broadcastAudioMetrics();
          }
          sendResponse(response);
          return;
        }

        console.warn('Detected active stream capture conflict, attempting recovery retry...');

        sendToOffscreen({ type: 'OFFSCREEN_STOP_CAPTURE' })
          .catch(() => {
            // Best effort cleanup.
          })
          .finally(() => {
            setTimeout(() => {
              sendToOffscreen({ type: 'OFFSCREEN_START_CAPTURE', streamId })
                .then((retryResponse) => {
                  if (!retryResponse.error) {
                    setRecordingActive('startRecordingOffscreen:retry-start-capture');
                    beginAudioMetrics();
                    broadcastAudioMetrics();
                  }
                  sendResponse(retryResponse);
                })
                .catch((retryErr) => sendResponse({ error: retryErr.message }));
            }, 250);
          });
      })
      .catch((err) => sendResponse({ error: err.message }));
  };

  // If streamId is provided from popup, use it directly
  if (message.streamId) {
    sendToOffscreen({ type: 'OFFSCREEN_CONNECT' })
      .then((connectResponse) => {
        if (connectResponse && connectResponse.error) {
          sendResponse({ error: connectResponse.error });
          return;
        }
        
        setTimeout(async () => {
          sendToOffscreen({
            type: 'OFFSCREEN_START_SESSION',
            language: message.language || 'ru-RU',
            platform: message.platform,
            audioMode,
            token: await getSkriboToken(),
            resumeMeetingId: await resumeMeetingIdForStart(),
          })
            .then((sessionResponse) => {
              if (sessionResponse && sessionResponse.error) {
                sendResponse({ error: sessionResponse.error });
                return;
              }

              setTimeout(() => {
                if (shouldSkipTabCapture) {
                  setRecordingActive('startRecordingOffscreen:skip-tab-capture');
                  beginAudioMetrics();
                  broadcastAudioMetrics();
                  sendResponse({ success: true });
                  return;
                }

                startCaptureWithActiveStreamRecovery(message.streamId);
              }, 100);
            })
            .catch((err) => sendResponse({ error: err.message }));
        }, 200);
      })
      .catch((err) => sendResponse({ error: err.message }));
    return;
  }

  // Fallback: Get active tab and streamId in service worker
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) {
      sendResponse({ error: 'No active tab found' });
      return;
    }

    chrome.tabCapture.getMediaStreamId(
      { targetTabId: tabs[0].id },
      (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          sendResponse({ error: chrome.runtime.lastError?.message || 'Failed to get media stream ID' });
          return;
        }

        sendToOffscreen({ type: 'OFFSCREEN_CONNECT' })
          .then(() => {
            setTimeout(async () => {
              sendToOffscreen({
                type: 'OFFSCREEN_START_SESSION',
                language: message.language || 'ru-RU',
                platform: message.platform,
                audioMode,
                token: await getSkriboToken(),
                resumeMeetingId: await resumeMeetingIdForStart(),
              })
                .then(() => {
                  setTimeout(() => {
                    if (shouldSkipTabCapture) {
                      setRecordingActive('startRecordingOffscreen:skip-tab-capture-fallback');
                      beginAudioMetrics();
                      broadcastAudioMetrics();
                      sendResponse({ success: true });
                      return;
                    }

                    startCaptureWithActiveStreamRecovery(streamId);
                  }, 100);
                })
                .catch((err) => sendResponse({ error: err.message }));
            }, 200);
          })
          .catch((err) => sendResponse({ error: err.message }));
      }
    );
  });
}

// Helper function for stopping offscreen recording
function stopRecordingOffscreen(sendResponse: (response: any) => void, reason = 'unknown') {
  console.log('stopRecordingOffscreen called', { reason, recordingState, wsState, sessionId, recordingTabId });

  sendToOffscreen({ type: 'OFFSCREEN_STOP_SESSION', reason })
    .then(() => {
      return sendToOffscreen({ type: 'OFFSCREEN_DISCONNECT', reason: `stopRecordingOffscreen:${reason}` });
    })
    .then((response) => {
      setRecordingIdle({ reason: `stopRecordingOffscreen:${reason}` });
      setWsStateDisconnected(`stopRecordingOffscreen:${reason}`);
      activeRecordingStartMessage = null;
      perTrackRecoveryInProgress = false;
      broadcastWsRecoveryStatus();
      sendResponse(response);
    })
    .catch((err) => {
      setRecordingIdle({ reason: `stopRecordingOffscreen:error:${reason}` });
      setWsStateError(`stopRecordingOffscreen:error:${reason}`);
      activeRecordingStartMessage = null;
      perTrackRecoveryInProgress = false;
      broadcastWsRecoveryStatus();
      sendResponse({ error: err.message });
    });
}

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Status updates from offscreen document
  if (message.type === 'WS_STATUS') {
    console.log('WebSocket status:', message.status, message.closeInfo || null);
    const previousRecordingState = recordingState;
    const previousWsState = wsState;
    
    if (message.status === 'connected') {
      setWsStateConnected('WS_STATUS:connected');
      if (recordingState === 'recording' && activeRecordingStartMessage && recordingSegmentStartedAtMs === null) {
        beginAudioMetrics();
      }
    } else if (message.status === 'disconnected') {
      setWsStateDisconnected(`WS_STATUS:disconnected:${message.closeInfo?.code ?? 'no-code'}`);

      // If we were recording, stop it first unless per-track recovery can restore session.
      if (recordingState === 'recording') {
        if (currentAudioMode === 'per-track' && activeRecordingStartMessage) {
          resetAudioLevels();
          broadcastAudioLevels();
          recoverPerTrackSession(`ws-disconnected:${message.closeInfo?.code ?? 'no-code'}`).catch(() => {});
          return false;
        }

        console.warn('WS disconnected while recording, requesting OFFSCREEN_STOP_SESSION', {
          closeInfo: message.closeInfo || null,
          sessionId,
          recordingTabId,
        });
        sendToOffscreen({
          type: 'OFFSCREEN_STOP_SESSION',
          reason: `ws-disconnected:${message.closeInfo?.code ?? 'no-code'}`,
        }).catch(() => {});

        setRecordingIdle({
          reason: `WS_STATUS:disconnected:${message.closeInfo?.code ?? 'no-code'}`,
        });
      }
    } else if (message.status === 'error') {
      setWsStateError('WS_STATUS:error');

      // Only stop recording for active sessions.
      if (recordingState === 'recording') {
        sendToOffscreen({ type: 'OFFSCREEN_STOP_SESSION' }).catch(() => {});
        setRecordingIdle({ reason: 'WS_STATUS:error' });
      }
    }
    
    if (previousRecordingState !== recordingState || previousWsState !== wsState) {
      console.log('State snapshot after WS_STATUS', {
        previousRecordingState,
        recordingState,
        previousWsState,
        wsState,
      });
    }
    return false;
  }

  if (message.type === 'WS_MESSAGE') {
    const wsMessage = message.message;
    if (wsMessage.type === 'status') {
      if (wsMessage.sessionId) {
        sessionId = wsMessage.sessionId;
      }

      // Remember which meeting this recording persists into, so a reconnect can continue it
      // instead of opening a second entry in the cabinet for the same call.
      if (wsMessage.meetingId) {
        activeMeetingId = wsMessage.meetingId;
        rememberMeeting(wsMessage.meetingId).catch(() => {});
      }

      if (wsMessage.status === 'connected') {
        setWsStateConnected('WS_MESSAGE:status=connected');
      } else if (wsMessage.status === 'recording') {
        setWsStateConnected('WS_MESSAGE:status=recording');
        setRecordingActive('WS_MESSAGE:status=recording');
      } else if (wsMessage.status === 'idle') {
        if (!activeRecordingStartMessage) {
          setRecordingIdle({ reason: 'WS_MESSAGE:status=idle' });
          setWsStateDisconnected('WS_MESSAGE:status=idle');
        } else {
          console.warn('Ignoring WS idle status while active recording start is present', {
            sessionId: wsMessage.sessionId ?? sessionId,
            audioMode: currentAudioMode,
          });
        }
      }
    }

    // A revoked token can only be cleared here: leaving it in storage means the popup keeps
    // thinking it is signed in, and every future call transcribes into nowhere. Dropping it makes
    // the next popup open re-authenticate (silently, if the cabinet session is still alive).
    if (wsMessage.type === 'error' && wsMessage.code === AUTH_INVALID_TOKEN) {
      console.warn('Extension token rejected by server; clearing it so the popup re-authenticates');
      chrome.storage.local.remove(['skriboToken', 'skriboAccountEmail']).catch(() => {});
    }

    // Forward websocket messages to the tab where recording was started.
    // Content script needs `status` to receive `sessionId` for speaker updates.
    // `stt_status` (LS-04) drives the STT-health banner in the widget.
    if (
      wsMessage.type === 'status' ||
      wsMessage.type === 'partial' ||
      wsMessage.type === 'final' ||
      wsMessage.type === 'error' ||
      wsMessage.type === 'stt_status'
    ) {
      forwardToContentScript({ type: 'WS_MESSAGE', message: wsMessage });
    }
    return false;
  }

  if (message.type === 'AUDIO_PROGRESS') {
    if (
      activeRecordingStartMessage !== null &&
      typeof message.durationMs === 'number' &&
      Number.isFinite(message.durationMs) &&
      message.durationMs > 0
    ) {
      if (recordingSegmentStartedAtMs === null) {
        beginAudioMetrics();
      }
      deepgramAudioSentMs += message.durationMs;
      broadcastAudioMetrics();
    }
    return false;
  }

  if (message.type === 'MIXED_AUDIO_LEVEL') {
    if (recordingState !== 'recording' || currentAudioMode !== 'mixed') {
      return false;
    }

    const rmsInput = normalizeLevel(message.rms);
    const peakInput = normalizeLevel(message.peak);

    if (!mixedAudioLevel) {
      mixedAudioLevel = {
        rms: rmsInput,
        peak: peakInput,
        timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
      };
    } else {
      mixedAudioLevel = {
        rms: mixedAudioLevel.rms * (1 - AUDIO_LEVELS_EMA_ALPHA) + rmsInput * AUDIO_LEVELS_EMA_ALPHA,
        peak: mixedAudioLevel.peak * (1 - AUDIO_LEVELS_EMA_ALPHA) + peakInput * AUDIO_LEVELS_EMA_ALPHA,
        timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now(),
      };
    }

    broadcastAudioLevels();
    return false;
  }

  if (message.type === 'TRACK_AUDIO_LEVEL') {
    if (recordingState !== 'recording' || currentAudioMode !== 'per-track') {
      return false;
    }

    if (typeof message.participantId !== 'string' || !message.participantId) {
      return false;
    }

    const existing = perTrackAudioLevels.get(message.participantId);
    const rmsInput = normalizeLevel(message.rms);
    const peakInput = normalizeLevel(message.peak);
    const timestamp = typeof message.timestamp === 'number' ? message.timestamp : Date.now();

    if (!existing) {
      perTrackAudioLevels.set(message.participantId, {
        participantId: message.participantId,
        speaker: typeof message.speaker === 'string' && message.speaker.trim() ? message.speaker : null,
        rms: rmsInput,
        peak: peakInput,
        timestamp,
      });
    } else {
      perTrackAudioLevels.set(message.participantId, {
        participantId: existing.participantId,
        speaker:
          typeof message.speaker === 'string' && message.speaker.trim()
            ? message.speaker
            : existing.speaker,
        rms: existing.rms * (1 - AUDIO_LEVELS_EMA_ALPHA) + rmsInput * AUDIO_LEVELS_EMA_ALPHA,
        peak: existing.peak * (1 - AUDIO_LEVELS_EMA_ALPHA) + peakInput * AUDIO_LEVELS_EMA_ALPHA,
        timestamp,
      });
    }

    broadcastAudioLevels();
    return false;
  }

  if (message.type === 'CAPTURE_STATUS') {
    console.log('Capture status:', message.status);
    if (message.status === 'recording') {
      setRecordingActive('CAPTURE_STATUS:recording');
    } else if (message.status === 'stopped') {
      // Only update to idle if we were recording
      if (recordingState === 'recording') {
        setRecordingIdle({ reason: 'CAPTURE_STATUS:stopped' });
      }
    }
    return false;
  }

  // Handle popup messages
  console.log('Received message:', message.type);

  if (message.type === 'CONNECT') {
    sendToOffscreen({ type: 'OFFSCREEN_CONNECT' })
      .then((response) => sendResponse(response))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'START_RECORDING') {
    if (sender.tab?.id) {
      recordingTabId = sender.tab.id;
    }
    currentAudioMode = resolveAudioMode(message.audioMode, message.platform);
    activeRecordingStartMessage = {
      language: message.language,
      platform: message.platform,
      audioMode: currentAudioMode,
    };
    // Identify the call from its url, then let the remembered meeting decide: pressing start
    // again inside the same call continues it, a different call opens a new one.
    activeCallKey = buildCallKey(sender.tab?.url, sender.tab?.id);
    activeMeetingId = null;
    perTrackRecoveryInProgress = false;
    broadcastWsRecoveryStatus();
    resetAudioLevels();
    broadcastAudioLevels();

    // Check if we are really recording or just have stale state.
    if (recordingState === 'recording') {
      sendToOffscreen({ type: 'OFFSCREEN_GET_STATUS' })
        .then((offscreenStatus) => {
          if (offscreenStatus?.capturing) {
            sendResponse({ error: 'Recording already in progress' });
            return;
          }

          // Stale state: allow fresh start
          setRecordingIdle({
            reason: 'START_RECORDING:stale-state-contention',
            pauseMetrics: false,
            resetLevels: false,
            broadcastMetrics: false,
            broadcastLevels: false,
          });
          startRecordingOffscreen(message, sendResponse);
        })
        .catch(() => {
          // If status check fails, try to recover by attempting a fresh start
          setRecordingIdle({
            reason: 'START_RECORDING:stale-state-contention-catch',
            pauseMetrics: false,
            resetLevels: false,
            broadcastMetrics: false,
            broadcastLevels: false,
          });
          startRecordingOffscreen(message, sendResponse);
        });
      return true;
    }

    // Use offscreen document with tabCapture (user will hear audio)
    startRecordingOffscreen(message, sendResponse);
    return true;
  }

  if (message.type === 'SPEAKER_UPDATE') {
    // Forward speaker updates to offscreen (it holds the WS connection)
    sendToOffscreen({
      type: 'OFFSCREEN_SPEAKER_UPDATE',
      sessionId: message.sessionId,
      speaker: message.speaker,
      participantId: message.participantId,
    }).catch(() => {
      // ignore
    });
    return false;
  }

  if (message.type === 'TRACK_AUDIO_CHUNK') {
    sendToOffscreen({
      type: 'OFFSCREEN_TRACK_AUDIO_CHUNK',
      sessionId: message.sessionId,
      participantId: message.participantId,
      speaker: message.speaker,
      sampleRate: message.sampleRate,
      channels: message.channels,
      chunk: message.chunk,
    })
      .then((response) => {
        if (
          response?.error &&
          currentAudioMode === 'per-track' &&
          typeof response.error === 'string' &&
          response.error.includes('WebSocket is not connected')
        ) {
          recoverPerTrackSession('track-audio-chunk-no-ws').catch(() => {});
        }
      })
      .catch(() => {
        // ignore
      });
    return false;
  }

  if (message.type === 'STOP_RECORDING') {
    console.log('STOP_RECORDING received', {
      senderTabId: sender.tab?.id ?? null,
      recordingTabId,
      sessionId,
      recordingState,
      wsState,
    });
    recordingTabId = null;
    activeRecordingStartMessage = null;
    perTrackRecoveryInProgress = false;
    broadcastWsRecoveryStatus();
    resetAudioLevels();
    broadcastAudioLevels();

    // Stop recording via offscreen document
    stopRecordingOffscreen(sendResponse, 'stop-recording-message');
    return true;
  }


  if (message.type === 'GET_STATUS') {
    // Try content script first, then offscreen
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'CONTENT_GET_STATUS' }, (response) => {
          if (!chrome.runtime.lastError && response) {
            // Content script responded
            if (response.status === 'recording') {
              setRecordingActive('GET_STATUS:content-response');
            } else if (response.status === 'error') {
              setRecordingState('error', 'GET_STATUS:content-response');
            } else {
              setRecordingIdle({
                reason: 'GET_STATUS:content-response',
                pauseMetrics: false,
                resetLevels: false,
                broadcastMetrics: false,
                broadcastLevels: false,
              });
            }
            sessionId = response.sessionId || null;
            sendResponse({
              status: getUiStatus(),
              sessionId,
              wsRecovering: perTrackRecoveryInProgress,
              ...getAudioMetricsSnapshot(),
            });
            return;
          }

          // Fallback to offscreen
          sendToOffscreen({ type: 'OFFSCREEN_GET_STATUS' })
            .then((offscreenStatus) => {
              if (offscreenStatus && !offscreenStatus.wsConnected && wsState === 'connected') {
                console.log('WebSocket not connected but wsState is connected, fixing...');
                setWsStateDisconnected('GET_STATUS:offscreen-fallback');
              }
              sendResponse({
                status: getUiStatus(),
                sessionId,
                wsRecovering: perTrackRecoveryInProgress,
                ...getAudioMetricsSnapshot(),
              });
            })
            .catch(() => {
              console.log('Could not reach offscreen, returning current status:', getUiStatus());
              sendResponse({
                status: getUiStatus(),
                sessionId,
                wsRecovering: perTrackRecoveryInProgress,
                ...getAudioMetricsSnapshot(),
              });
            });
        });
      } else {
        // No active tab, use offscreen
        sendToOffscreen({ type: 'OFFSCREEN_GET_STATUS' })
          .then((offscreenStatus) => {
            if (offscreenStatus && !offscreenStatus.wsConnected && wsState === 'connected') {
              setWsStateDisconnected('GET_STATUS:no-active-tab');
            }
            sendResponse({
              status: getUiStatus(),
              sessionId,
              wsRecovering: perTrackRecoveryInProgress,
              ...getAudioMetricsSnapshot(),
            });
          })
          .catch(() => {
            sendResponse({
              status: getUiStatus(),
              sessionId,
              wsRecovering: perTrackRecoveryInProgress,
              ...getAudioMetricsSnapshot(),
            });
          });
      }
    });
    return true;
  }

  if (message.type === 'GET_STREAM_ID') {
    // Get streamId for content script fallback
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        sendResponse({ error: 'No active tab found' });
        return;
      }

      chrome.tabCapture.getMediaStreamId({ targetTabId: tabs[0].id }, (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          sendResponse({ error: chrome.runtime.lastError?.message || 'Failed to get stream ID' });
          return;
        }
        sendResponse({ streamId });
      });
    });
    return true;
  }

  if (message.type === 'CONTENT_STATUS_UPDATE') {
    // Status update from content script
    if (message.status === 'recording') {
      setRecordingActive('CONTENT_STATUS_UPDATE');
    } else if (message.status === 'error') {
      setRecordingState('error', 'CONTENT_STATUS_UPDATE');
    } else {
      setRecordingIdle({
        reason: 'CONTENT_STATUS_UPDATE',
        pauseMetrics: false,
        resetLevels: false,
        broadcastMetrics: false,
        broadcastLevels: false,
      });
    }
    if (message.sessionId) {
      sessionId = message.sessionId;
    }
    return false;
  }

  if (message.type === 'RESET_RECORDING_STATE') {
    resetAudioMetrics({ keepRunning: message.keepRunning === true });
    resetAudioLevels();
    broadcastAudioMetrics();
    broadcastAudioLevels();
    sendResponse({ success: true, ...getAudioMetricsSnapshot() });
    return true;
  }

  if (message.type === 'TRANSCRIPT_UPDATE') {
    // Transcript update from content script - no longer needed
    return false;
  }

  if (message.type === 'DISCONNECT') {
    sendToOffscreen({ type: 'OFFSCREEN_DISCONNECT' })
      .then((response) => {
        setRecordingIdle({ reason: 'DISCONNECT' });
        setWsStateDisconnected('DISCONNECT');
        activeRecordingStartMessage = null;
        perTrackRecoveryInProgress = false;
        broadcastWsRecoveryStatus();
        sendResponse(response);
      })
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'LIVE_SUMMARY') {
    (async () => {
      const token = await getSkriboToken();
      if (!token) { sendResponse({ error: 'not_authed' }); return; }
      try {
        const res = await fetch(`${__API_URL__}/api/live-summary`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ transcript: typeof message.transcript === 'string' ? message.transcript : '' }),
        });
        if (!res.ok) {
          let code = `http_${res.status}`;
          try { const b = await res.json(); if (b?.error) code = b.error; } catch { /* ignore */ }
          sendResponse({ error: code });
          return;
        }
        const data = (await res.json()) as { bullets?: unknown };
        sendResponse({ bullets: Array.isArray(data?.bullets) ? data.bullets : [] });
      } catch {
        sendResponse({ error: 'network' });
      }
    })();
    return true; // async response
  }

  if (message.type === TOGGLE_WIDGET_IN_ACTIVE_TAB) {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        sendResponse({ error: 'no_tab' } satisfies WidgetToggleResult);
        return;
      }
      sendResponse(await toggleWidgetInTab(tab.id));
    })();
    return true; // async response
  }

  return false;
});

// Show/hide the in-page widget. The content script is normally already there (declared in the
// manifest), but on a page that was open before install/reload it is missing — inject it from
// the runtime manifest and retry once.
async function toggleWidgetInTab(tabId: number): Promise<WidgetToggleResult> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_TOGGLE_WIDGET' });
    return { action: response?.action === 'hidden' ? 'hidden' : 'shown' };
  } catch {
    // fall through to injection
  }

  const manifest = chrome.runtime.getManifest();
  const contentScriptEntry = manifest.content_scripts?.find((entry) =>
    entry.js?.some((scriptPath) => scriptPath.includes('content.js')),
  );
  if (!contentScriptEntry?.js?.length) {
    console.error('No content script entry found in manifest for fallback injection');
    return { error: 'no_content_script' };
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: contentScriptEntry.js });
  } catch (injectErr) {
    // Chrome refuses injection on unsupported pages (chrome://, Web Store, PDF viewer…).
    console.error('Failed to inject content script:', injectErr);
    return { error: 'unsupported_page' };
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'CONTENT_TOGGLE_WIDGET' });
    return { action: response?.action === 'hidden' ? 'hidden' : 'shown' };
  } catch (err) {
    console.error('Failed to toggle widget after injection:', err);
    return { error: 'no_content_script' };
  }
}

// Keep service worker alive periodically
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    console.log('Service worker keepalive');
  }
});

console.log('Service worker ready');
