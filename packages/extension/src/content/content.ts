// Content script for LiveScribe widget UI
// Audio capture is handled by service worker + offscreen document

import { createPlatformAdapter } from './platform/platform-adapter';
import { RecordingController } from './recording/recording-controller';

console.log('LiveScribe content script loaded');
console.log('[LiveScribe] content build marker: 2026-02-20-track-transcriber-diagnostics');

let isCapturing = false;
let contentSessionId: string | null = null;
let isMinimized = false;
let recordingStartedAtMs: number | null = null;
let recordingPausedSeconds = 0;
let deepgramAudioSeconds = 0;
let metricsTickerId: number | null = null;
let wsRecovering = false;
let wsRecoveredToastUntilMs = 0;
let wsRecoveredToastTimerId: number | null = null;
let audioLevelsMode: 'mixed' | 'per-track' = 'mixed';
let mixedAudioLevel: { rms: number; peak: number; timestamp: number } | null = null;
let speakerAudioLevels: Array<{
  participantId: string;
  speaker: string | null;
  rms: number;
  peak: number;
  timestamp: number;
}> = [];

let currentSpeaker: string | null = null;
let speakerIntervalId: number | null = null;
const platformAdapter = createPlatformAdapter({
  getIsCapturing: () => isCapturing,
  getSessionId: () => contentSessionId,
});
const trackModeController = platformAdapter.getTrackModeController();
let recordingController: RecordingController | null = null;

interface TranscriptReplica {
  speaker: string;
  text: string;
  highlighted?: boolean;
}

let transcriptReplicas: TranscriptReplica[] = [];
let partialReplica: TranscriptReplica | null = null;
let lastFinalTimestamp: number | null = null;

let triggers: string[] = [];

const REPLICA_MERGE_PAUSE_MS = 3000;

function clearTranscriptState(): void {
  transcriptReplicas = [];
  partialReplica = null;
  lastFinalTimestamp = null;
  currentSpeaker = null;
  updateTranscript();
}

function appendTranscriptReplica(speaker: string, text: string, eventTimestamp: number): void {
  const trimmedText = text.trim();
  if (!trimmedText) return;

  const lastReplica = transcriptReplicas[transcriptReplicas.length - 1] || null;
  const withinMergePause =
    lastFinalTimestamp !== null &&
    eventTimestamp - lastFinalTimestamp <= REPLICA_MERGE_PAUSE_MS;

  if (lastReplica && lastReplica.speaker === speaker) {
    const normalizedLastText = lastReplica.text.trim();
    const isExactDuplicate = normalizedLastText === trimmedText;
    const isContainedDuplicate =
      normalizedLastText.endsWith(trimmedText) ||
      trimmedText.endsWith(normalizedLastText);

    if (isExactDuplicate || isContainedDuplicate) {
      lastFinalTimestamp = eventTimestamp;
      return;
    }
  }

  if (lastReplica && lastReplica.speaker === speaker && withinMergePause) {
    lastReplica.text = `${lastReplica.text} ${trimmedText}`.trim();
    if (matchesTrigger(trimmedText)) {
      lastReplica.highlighted = true;
      flashWidget();
    }
  } else {
    const newReplica: TranscriptReplica = { speaker, text: trimmedText };
    transcriptReplicas.push(newReplica);
    if (matchesTrigger(trimmedText)) {
      newReplica.highlighted = true;
      flashWidget();
    }
  }

  lastFinalTimestamp = eventTimestamp;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesTrigger(text: string): boolean {
  if (!triggers.length) return false;
  return triggers.some((t) => {
    const w = t.trim();
    if (!w) return false;
    try {
      return new RegExp('(^|\\P{L})' + escapeRegExp(w) + '($|\\P{L})', 'iu').test(text);
    } catch {
      return text.toLowerCase().includes(w.toLowerCase());
    }
  });
}

function flashWidget(): void {
  const w = document.getElementById('livescribe-widget');
  if (!w || typeof w.animate !== 'function') return;
  w.animate(
    [
      { boxShadow: '0 0 0 0 rgba(13,148,136,0)' },
      { boxShadow: '0 0 0 4px rgba(13,148,136,0.6)', offset: 0.3 },
      { boxShadow: '0 0 0 0 rgba(13,148,136,0)' },
    ],
    { duration: 1000, easing: 'ease' }
  );
}

function normalizeSpeaker(speaker?: string | null): string {
  const value = speaker?.trim();
  return value || 'Неизвестный спикер';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function collectTranscriptText(): string {
  const lines = transcriptReplicas.map((r) => `${r.speaker}: ${r.text}`);
  if (partialReplica && partialReplica.text.trim()) {
    lines.push(`${partialReplica.speaker}: ${partialReplica.text.trim()}`);
  }
  return lines.join('\n').trim();
}

function summaryErrorText(code: string): string {
  if (code === 'not_authed') return 'Войдите в расширении, чтобы получить саммари';
  if (code === 'analysis_unavailable' || code === 'http_503') return 'Саммари пока не настроено';
  if (code === 'no_transcript' || code === 'http_400') return 'Нет транскрипта для саммари';
  return 'Не удалось получить саммари. Попробуйте ещё раз';
}

function renderSummary(panel: HTMLElement, bullets: string[]): void {
  if (bullets.length === 0) {
    panel.innerHTML = '<div style="color:#6b7280; font-size:11px;">Пока нечего резюмировать.</div>';
    return;
  }
  panel.innerHTML =
    '<ul style="margin:0; padding-left:16px; line-height:1.5;">' +
    bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('') +
    '</ul>';
}

function requestLiveSummary(): void {
  const panel = document.getElementById('skribo-summary-panel');
  const btn = document.getElementById('skribo-summary-btn') as HTMLButtonElement | null;
  if (!panel) return;
  const transcript = collectTranscriptText();
  panel.style.display = 'block';
  if (!transcript) {
    panel.innerHTML = '<div style="color:#6b7280; font-size:11px;">Нет транскрипта для саммари</div>';
    return;
  }
  panel.innerHTML = '<div style="color:#6b7280; font-size:11px;">Готовим саммари…</div>';
  if (btn) btn.disabled = true;
  chrome.runtime.sendMessage({ type: 'LIVE_SUMMARY', transcript }, (response) => {
    if (btn) { btn.disabled = false; btn.textContent = 'Обновить саммари'; }
    if (chrome.runtime.lastError || !response) { panel.innerHTML = `<div style="color:#b91c1c; font-size:11px;">${escapeHtml(summaryErrorText('network'))}</div>`; return; }
    if (response.error) { panel.innerHTML = `<div style="color:#b91c1c; font-size:11px;">${escapeHtml(summaryErrorText(String(response.error)))}</div>`; return; }
    renderSummary(panel, Array.isArray(response.bullets) ? response.bullets.map(String) : []);
  });
}

function normalizeTrigger(w: string): string {
  return w.trim();
}

async function loadTriggers(): Promise<void> {
  try {
    const { skriboTriggers } = await chrome.storage.local.get('skriboTriggers');
    triggers = Array.isArray(skriboTriggers) ? skriboTriggers.filter((t) => typeof t === 'string') : [];
  } catch {
    triggers = [];
  }
}

async function saveTriggers(): Promise<void> {
  try {
    await chrome.storage.local.set({ skriboTriggers: triggers });
  } catch {
    /* ignore */
  }
}

function addTrigger(raw: string): void {
  const w = normalizeTrigger(raw);
  if (!w) return;
  if (triggers.some((t) => t.toLowerCase() === w.toLowerCase())) return;
  triggers.push(w);
  void saveTriggers();
  renderTriggers();
}

function removeTrigger(w: string): void {
  triggers = triggers.filter((t) => t !== w);
  void saveTriggers();
  renderTriggers();
}

function renderTriggers(): void {
  const list = document.getElementById('skribo-triggers-list');
  if (!list) return;

  list.innerHTML = triggers
    .map(
      (word) => `
        <span style="
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 6px;
          background: #e5e7eb;
          color: #374151;
          border-radius: 12px;
          font-size: 11px;
        ">${escapeHtml(word)}<span class="skribo-trigger-remove" data-word="${escapeHtml(word)}" style="cursor: pointer; color: #6b7280; font-weight: 700;">&times;</span></span>
      `
    )
    .join('');

  list.querySelectorAll('.skribo-trigger-remove').forEach((el) => {
    el.addEventListener('click', () => {
      const word = el.getAttribute('data-word');
      if (word) removeTrigger(word);
    });
  });
}

function startSpeakerTracking(): void {
  stopSpeakerTracking();

  // Polling is simplest and works even when DOM updates are subtle.
  speakerIntervalId = window.setInterval(() => {
    if (!isCapturing || !contentSessionId) return;

    const info = platformAdapter.getActiveSpeaker();
    if (!info) return;

    const nextSpeaker = info?.speaker ?? null;

    if (nextSpeaker === currentSpeaker) return;
    currentSpeaker = nextSpeaker;

    chrome.runtime.sendMessage({
      type: 'SPEAKER_UPDATE',
      sessionId: contentSessionId,
      speaker: currentSpeaker,
      participantId: info?.participantId,
    }).catch(() => {
      // service worker might be inactive
    });
  }, 250);
}

function stopSpeakerTracking(): void {
  if (speakerIntervalId !== null) {
    clearInterval(speakerIntervalId);
    speakerIntervalId = null;
  }
}

function formatDuration(secondsTotal: number): string {
  const safeSeconds = Math.max(0, Math.floor(secondsTotal));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function getCurrentRecordingSeconds(): number {
  const currentSegmentSeconds = recordingStartedAtMs
    ? Math.max(0, Math.floor((Date.now() - recordingStartedAtMs) / 1000))
    : 0;

  return Math.max(0, recordingPausedSeconds + currentSegmentSeconds);
}

function renderAudioMetrics(): void {
  const recordingValue = document.getElementById('livescribe-recording-seconds');
  const deepgramValue = document.getElementById('livescribe-deepgram-seconds');

  if (recordingValue) {
    recordingValue.textContent = formatDuration(getCurrentRecordingSeconds());
  }
  if (deepgramValue) {
    deepgramValue.textContent = formatDuration(deepgramAudioSeconds);
  }
}

function startMetricsTicker(): void {
  if (metricsTickerId !== null) return;

  metricsTickerId = window.setInterval(() => {
    renderAudioMetrics();
  }, 1000);
}

function stopMetricsTicker(): void {
  if (metricsTickerId !== null) {
    window.clearInterval(metricsTickerId);
    metricsTickerId = null;
  }
}

function applyAudioMetrics(update: {
  recordingStartedAtMs?: number | null;
  recordingSeconds?: number;
  deepgramSeconds?: number;
}): void {
  if (Object.prototype.hasOwnProperty.call(update, 'recordingStartedAtMs')) {
    recordingStartedAtMs = update.recordingStartedAtMs ? Date.now() : null;
  } else if (typeof update.recordingSeconds === 'number' && update.recordingSeconds > 0) {
    recordingStartedAtMs = isCapturing ? Date.now() : null;
  }

  if (typeof update.recordingSeconds === 'number' && Number.isFinite(update.recordingSeconds)) {
    recordingPausedSeconds = Math.max(0, Math.floor(update.recordingSeconds));
  }

  if (typeof update.deepgramSeconds === 'number' && Number.isFinite(update.deepgramSeconds)) {
    deepgramAudioSeconds = Math.max(0, Math.floor(update.deepgramSeconds));
  }

  if (isCapturing && recordingStartedAtMs) {
    startMetricsTicker();
  } else {
    stopMetricsTicker();
  }

  renderAudioMetrics();
}

function resetAudioMetrics(): void {
  recordingStartedAtMs = null;
  recordingPausedSeconds = 0;
  deepgramAudioSeconds = 0;
  stopMetricsTicker();
  renderAudioMetrics();
}

function requestCurrentStatusAndMetrics(): void {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      return;
    }

    if (response.status === 'recording') {
      isCapturing = true;
      contentSessionId = response.sessionId || contentSessionId;
      wsRecovering = response.wsRecovering === true;
      updateStatus('recording');
      applyAudioMetrics({
        recordingStartedAtMs: response.recordingStartedAtMs ?? null,
        recordingSeconds: response.recordingSeconds,
        deepgramSeconds: response.deepgramSeconds,
      });
      return;
    }

    isCapturing = false;
    wsRecovering = false;
    clearRecoveredToast();
    updateStatus('idle');
    applyAudioMetrics({
      recordingStartedAtMs: null,
      recordingSeconds: response.recordingSeconds,
      deepgramSeconds: response.deepgramSeconds,
    });
  });
}

function renderWsRecoveryIndicator(): void {
  const wsRecovery = document.getElementById('livescribe-ws-recovery');
  if (!wsRecovery) return;

  if (isCapturing && wsRecovering) {
    wsRecovery.style.display = 'block';
    wsRecovery.textContent = 'WS recovering...';
    wsRecovery.style.background = '#fff7ed';
    wsRecovery.style.color = '#9a3412';
    wsRecovery.style.borderColor = '#fdba74';
    return;
  }

  if (isCapturing && Date.now() < wsRecoveredToastUntilMs) {
    wsRecovery.style.display = 'block';
    wsRecovery.textContent = 'WS recovered';
    wsRecovery.style.background = '#ecfdf5';
    wsRecovery.style.color = '#166534';
    wsRecovery.style.borderColor = '#86efac';
    return;
  }

  wsRecovery.style.display = 'none';
  wsRecovery.textContent = '';
}

function clearRecoveredToast(): void {
  wsRecoveredToastUntilMs = 0;
  if (wsRecoveredToastTimerId !== null) {
    clearTimeout(wsRecoveredToastTimerId);
    wsRecoveredToastTimerId = null;
  }
}

function showRecoveredToast(durationMs = 3000): void {
  clearRecoveredToast();
  wsRecoveredToastUntilMs = Date.now() + durationMs;
  wsRecoveredToastTimerId = window.setTimeout(() => {
    wsRecoveredToastTimerId = null;
    wsRecoveredToastUntilMs = 0;
    renderWsRecoveryIndicator();
  }, durationMs);
  renderWsRecoveryIndicator();
}

function normalizeAudioLevel(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatParticipantFallback(participantId: string): string {
  const normalized = participantId.replace(/^participant_/i, '').trim();
  if (!normalized) return 'Participant';

  const shortId = normalized.length > 18 ? `${normalized.slice(0, 8)}…${normalized.slice(-6)}` : normalized;
  return `Participant ${shortId}`;
}

function formatRmsValue(value: number): string {
  return normalizeAudioLevel(value).toFixed(5);
}

function renderAudioLevels(): void {
  const levelsContainer = document.getElementById('livescribe-audio-levels');
  const levelsContent = document.getElementById('livescribe-audio-levels-content');

  if (!levelsContainer || !levelsContent) return;

  levelsContainer.style.display = isCapturing ? 'block' : 'none';
  if (!isCapturing) return;

  if (audioLevelsMode === 'per-track') {
    if (speakerAudioLevels.length === 0) {
      levelsContent.innerHTML = '<div style="font-size: 11px; color: #6b7280;">Waiting for speakers...</div>';
      return;
    }

    levelsContent.innerHTML = speakerAudioLevels
      .map((speakerLevel) => {
        const label = escapeHtml(
          (typeof speakerLevel.speaker === 'string' && speakerLevel.speaker.trim()) ||
            formatParticipantFallback(speakerLevel.participantId),
        );
        const barWidth = Math.round(normalizeAudioLevel(speakerLevel.rms) * 100);
        const rmsValue = formatRmsValue(speakerLevel.rms);

        return `
          <div style="margin-top: 6px;">
            <div style="display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: #374151; margin-bottom: 3px;">
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${label}</span>
              <span style="font-variant-numeric: tabular-nums; color: #6b7280;">RMS ${rmsValue}</span>
            </div>
            <div style="height: 6px; background: #e5e7eb; border-radius: 999px; overflow: hidden;">
              <div style="height: 100%; width: ${barWidth}%; background: #3b82f6; border-radius: 999px;"></div>
            </div>
          </div>
        `;
      })
      .join('');
    return;
  }

  const mixedRms = normalizeAudioLevel(mixedAudioLevel?.rms ?? 0);
  const mixedBarWidth = Math.round(mixedRms * 100);
  levelsContent.innerHTML = `
    <div style="font-size: 11px; color: #374151; margin-bottom: 4px;">Current track level (RMS)</div>
    <div style="height: 8px; background: #e5e7eb; border-radius: 999px; overflow: hidden;">
      <div style="height: 100%; width: ${mixedBarWidth}%; background: #10b981; border-radius: 999px;"></div>
    </div>
    <div style="font-size: 11px; color: #6b7280; margin-top: 4px; font-variant-numeric: tabular-nums; text-align: right;">RMS ${formatRmsValue(mixedRms)}</div>
  `;
}

function applyAudioLevelsSnapshot(message: {
  mode?: 'mixed' | 'per-track';
  mixed?: { rms?: number; peak?: number; timestamp?: number } | null;
  speakers?: Array<{
    participantId?: string;
    speaker?: string | null;
    rms?: number;
    peak?: number;
    timestamp?: number;
  }>;
}): void {
  if (message.mode === 'mixed' || message.mode === 'per-track') {
    audioLevelsMode = message.mode;
  }

  if (message.mixed) {
    mixedAudioLevel = {
      rms: normalizeAudioLevel(message.mixed.rms),
      peak: normalizeAudioLevel(message.mixed.peak),
      timestamp: typeof message.mixed.timestamp === 'number' ? message.mixed.timestamp : Date.now(),
    };
  } else {
    mixedAudioLevel = null;
  }

  if (Array.isArray(message.speakers)) {
    speakerAudioLevels = message.speakers
      .filter((entry) => typeof entry.participantId === 'string' && entry.participantId.length > 0)
      .map((entry) => ({
        participantId: entry.participantId as string,
        speaker: typeof entry.speaker === 'string' ? entry.speaker : null,
        rms: normalizeAudioLevel(entry.rms),
        peak: normalizeAudioLevel(entry.peak),
        timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
      }));
  } else {
    speakerAudioLevels = [];
  }

  renderAudioLevels();
}

function resetAudioLevels(): void {
  audioLevelsMode = 'mixed';
  mixedAudioLevel = null;
  speakerAudioLevels = [];
  renderAudioLevels();
}

recordingController = new RecordingController({
  getIsCapturing: () => isCapturing,
  setIsCapturing: (value) => {
    isCapturing = value;
  },
  getSelectedLanguage,
  getPlatformForStartMessage: () => platformAdapter.getPlatform(),
  getAudioMode: () => platformAdapter.getAudioMode(),
  shouldLogAudioMode: () => platformAdapter.supportsAudioModeSelection(),
  updateStatus,
  startSpeakerTracking,
  stopSpeakerTracking,
  trackModeController,
});

// Language options (currently supported by Deepgram STT)
const LANGUAGES = [
  { value: 'ru-RU', label: 'Russian' },
  { value: 'en-US', label: 'English' },
];

// Get selected language from localStorage with error handling
function getSelectedLanguage(): string {
  try {
    return localStorage.getItem('livescribe-language') || 'ru-RU';
  } catch (err) {
    console.warn('Failed to access localStorage, using default language:', err);
    return 'ru-RU';
  }
}

// Save selected language to localStorage with error handling
function saveSelectedLanguage(language: string): void {
  try {
    localStorage.setItem('livescribe-language', language);
  } catch (err) {
    console.warn('Failed to save language to localStorage:', err);
  }
}

// Get widget position from localStorage with error handling
function getWidgetPosition(): { x: number; y: number } {
  try {
    const saved = localStorage.getItem('livescribe-widget-position');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (err) {
    console.warn('Failed to access localStorage for position:', err);
  }
  return { x: 20, y: 20 };
}

// Save widget position to localStorage with error handling
function saveWidgetPosition(x: number, y: number): void {
  try {
    localStorage.setItem('livescribe-widget-position', JSON.stringify({ x, y }));
  } catch (err) {
    console.warn('Failed to save position to localStorage:', err);
  }
}

// Get widget size from localStorage with error handling
function getWidgetSize(): { width: number; height: number } {
  try {
    const saved = localStorage.getItem('livescribe-widget-size');
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (err) {
    console.warn('Failed to access localStorage for size:', err);
  }
  return { width: 400, height: 300 };
}

// Save widget size to localStorage with error handling
function saveWidgetSize(width: number, height: number): void {
  try {
    localStorage.setItem('livescribe-widget-size', JSON.stringify({ width, height }));
  } catch (err) {
    console.warn('Failed to save size to localStorage:', err);
  }
}

// Save minimized state to localStorage with error handling
function saveMinimizedState(minimized: boolean): void {
  try {
    localStorage.setItem('livescribe-widget-minimized', minimized ? 'true' : 'false');
  } catch (err) {
    console.warn('Failed to save minimized state to localStorage:', err);
  }
}

// Create UI widget
function createUIWidget() {
  // Check if widget already exists
  if (document.getElementById('livescribe-widget')) {
    return;
  }

  const position = getWidgetPosition();
  const size = getWidgetSize();
  const clampedLeft = Math.max(0, Math.min(window.innerWidth - size.width, position.x));
  const clampedTop = Math.max(0, Math.min(window.innerHeight - size.height, position.y));

  if (clampedLeft !== position.x || clampedTop !== position.y) {
    saveWidgetPosition(clampedLeft, clampedTop);
  }
  // Always create widget expanded, regardless of saved state
  isMinimized = false;

  const widget = document.createElement('div');
  widget.id = 'livescribe-widget';
  widget.style.cssText = `
    position: fixed;
    left: ${clampedLeft}px;
    top: ${clampedTop}px;
    width: ${size.width}px;
    height: ${size.height}px;
    min-width: 200px;
    min-height: 240px;
    max-width: 800px;
    max-height: 600px;
    z-index: 999999;
    background: white;
    border: 2px solid #3b82f6;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    resize: none;
    overflow: hidden;
  `;

  const selectedLanguage = getSelectedLanguage();
  const selectedAudioMode = platformAdapter.getAudioMode();
  const languageOptions = LANGUAGES.map(
    (lang) => `<option value="${lang.value}" ${lang.value === selectedLanguage ? 'selected' : ''}>${lang.label}</option>`
  ).join('');

  widget.innerHTML = `
    <div id="livescribe-header" style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: #f3f4f6;
      border-bottom: 1px solid #e5e7eb;
      cursor: move;
      user-select: none;
      flex-shrink: 0;
    ">
      <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
        <div id="livescribe-status" style="width: 12px; height: 12px; border-radius: 50%; background: #9ca3af; flex-shrink: 0;"></div>
        <span id="livescribe-status-text" style="font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Ready</span>
      </div>
      <div style="display: flex; gap: 4px; flex-shrink: 0;">
        <button id="livescribe-minimize" style="
          width: 24px;
          height: 24px;
          padding: 0;
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          color: #6b7280;
          display: flex;
          align-items: center;
          justify-content: center;
        " title="Minimize">▼</button>
        <button id="livescribe-close" style="
          width: 24px;
          height: 24px;
          padding: 0;
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
          color: #6b7280;
          display: flex;
          align-items: center;
          justify-content: center;
        " title="Close">×</button>
      </div>
    </div>
    <div id="livescribe-content" style="
      flex: 1;
      padding: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    ">
      <select id="livescribe-language" style="
        width: 100%;
        padding: 6px 8px;
        margin-bottom: 8px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 12px;
        background: white;
        cursor: pointer;
      ">
        ${languageOptions}
      </select>
      <select id="livescribe-audio-mode" style="
        width: 100%;
        padding: 6px 8px;
        margin-bottom: 8px;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 12px;
        background: white;
        cursor: pointer;
        display: ${platformAdapter.supportsAudioModeSelection() ? 'block' : 'none'};
      " title="Audio mode (applies on next start)">
        <option value="per-track" ${selectedAudioMode === 'per-track' ? 'selected' : ''}>Per-track</option>
        <option value="mixed" ${selectedAudioMode === 'mixed' ? 'selected' : ''}>Mixed</option>
      </select>
      <div style="display: flex; gap: 8px; margin-bottom: 8px;">
        <button id="livescribe-start" style="
          flex: 1;
          padding: 6px 12px;
          background: #10b981;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
        ">Start</button>
        <button id="livescribe-stop" style="
          flex: 1;
          padding: 6px 12px;
          background: #ef4444;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          display: none;
        ">Stop</button>
      </div>
      <button id="livescribe-reset" style="
        width: 100%;
        padding: 6px 12px;
        margin-bottom: 8px;
        background: #6b7280;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
      ">Reset</button>
      <div style="margin-bottom: 8px; padding: 8px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px; font-size: 11px; color: #374151;">
        <div style="display: flex; justify-content: space-between; gap: 8px;">
          <span>Recording:</span>
          <span id="livescribe-recording-seconds" style="font-variant-numeric: tabular-nums; font-weight: 600;">00:00</span>
        </div>
        <div style="display: flex; justify-content: space-between; gap: 8px; margin-top: 4px;">
          <span>Sent to Deepgram:</span>
          <span id="livescribe-deepgram-seconds" style="font-variant-numeric: tabular-nums; font-weight: 600;">00:00</span>
        </div>
      </div>
      <div style="margin-bottom: 8px;">
        <div style="font-size: 11px; color: #374151; font-weight: 600; margin-bottom: 4px;">Триггеры</div>
        <div style="display: flex; gap: 4px;">
          <input id="skribo-trigger-input" placeholder="Добавить слово…" style="flex: 1; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px;">
          <button id="skribo-trigger-add" style="
            padding: 6px 10px;
            background: #10b981;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
          ">+</button>
        </div>
        <div id="skribo-triggers-list" style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;"></div>
      </div>
      <div id="livescribe-ws-recovery" style="
        margin-bottom: 8px;
        padding: 6px 8px;
        border-radius: 4px;
        font-size: 11px;
        background: #fff7ed;
        color: #9a3412;
        border: 1px solid #fdba74;
        display: none;
      "></div>
      <div id="livescribe-audio-levels" style="display: none; margin-bottom: 8px; padding: 8px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 4px;">
        <div style="font-size: 11px; color: #374151; font-weight: 600; margin-bottom: 4px;">Audio levels</div>
        <div id="livescribe-audio-levels-content"></div>
      </div>
      <button id="skribo-summary-btn" style="
        width: 100%; padding: 6px 12px; margin-bottom: 8px;
        background: #0d9488; color: #fff; border: none; border-radius: 4px;
        cursor: pointer; font-size: 12px; font-weight: 500;
      ">Саммари встречи</button>
      <div id="skribo-summary-panel" style="
        display: none; margin-bottom: 8px; padding: 8px;
        background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 4px;
        font-size: 12px; color: #134e4a;
      "></div>
      <div id="livescribe-transcript" style="
        flex: 1;
        padding: 8px;
        background: #f3f4f6;
        border-radius: 4px;
        font-size: 12px;
        overflow-y: auto;
        overflow-x: hidden;
        min-height: 80px;
        display: none;
      ">
        <div id="livescribe-speaker" style="color: #6b7280; font-size: 11px; margin-bottom: 6px; display: none;"></div>
        <div id="livescribe-transcript-text" style="color: #374151; line-height: 1.5; word-wrap: break-word;"></div>
      </div>
      <div id="livescribe-error" style="
        margin-top: 8px;
        padding: 6px;
        background: #fee2e2;
        color: #991b1b;
        border-radius: 4px;
        font-size: 11px;
        display: none;
      "></div>
    </div>
    <div id="livescribe-resize-handle" style="
      position: absolute;
      bottom: 0;
      right: 0;
      width: 20px;
      height: 20px;
      cursor: nwse-resize;
      background: linear-gradient(-45deg, transparent 0%, transparent 30%, #9ca3af 30%, #9ca3af 35%, transparent 35%, transparent 65%, #9ca3af 65%, #9ca3af 70%, transparent 70%);
      z-index: 1;
    "></div>
  `;

  document.body.appendChild(widget);

  // Setup drag and drop
  setupDragAndDrop(widget);
  
  // Setup resize
  setupResize(widget);

  // Add event listeners
  document.getElementById('livescribe-start')?.addEventListener('click', handleStart);
  document.getElementById('livescribe-stop')?.addEventListener('click', handleStop);
  document.getElementById('livescribe-reset')?.addEventListener('click', handleReset);
  document.getElementById('skribo-summary-btn')?.addEventListener('click', requestLiveSummary);
  document.getElementById('skribo-trigger-add')?.addEventListener('click', () => {
    const input = document.getElementById('skribo-trigger-input') as HTMLInputElement | null;
    if (!input) return;
    addTrigger(input.value);
    input.value = '';
  });
  document.getElementById('skribo-trigger-input')?.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key !== 'Enter') return;
    const input = e.target as HTMLInputElement;
    addTrigger(input.value);
    input.value = '';
  });
  document.getElementById('livescribe-minimize')?.addEventListener('click', toggleMinimize);
  document.getElementById('livescribe-close')?.addEventListener('click', closeWidget);
  document.getElementById('livescribe-language')?.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement;
    saveSelectedLanguage(target.value);
  });
  document.getElementById('livescribe-audio-mode')?.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      if (target.value === 'mixed' || target.value === 'per-track') {
        platformAdapter.setAudioMode(target.value);
        console.log('[LiveScribe] audio mode changed', {
          platform: platformAdapter.getPlatform(),
          mode: target.value,
        });
      }
    });

  renderAudioMetrics();
  renderWsRecoveryIndicator();
  renderAudioLevels();
  requestCurrentStatusAndMetrics();
  void loadTriggers().then(renderTriggers);
}

// Setup drag and drop
function setupDragAndDrop(widget: HTMLElement): void {
  const header = document.getElementById('livescribe-header');
  if (!header) return;

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  header.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = widget.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    const newLeft = Math.max(0, Math.min(window.innerWidth - widget.offsetWidth, startLeft + deltaX));
    const newTop = Math.max(0, Math.min(window.innerHeight - widget.offsetHeight, startTop + deltaY));
    widget.style.left = `${newLeft}px`;
    widget.style.top = `${newTop}px`;
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      const rect = widget.getBoundingClientRect();
      saveWidgetPosition(rect.left, rect.top);
      isDragging = false;
    }
  });
}

// Setup resize
function setupResize(widget: HTMLElement): void {
  const resizeHandle = document.getElementById('livescribe-resize-handle');
  if (!resizeHandle) return;

  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startWidth = widget.offsetWidth;
    startHeight = widget.offsetHeight;
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    const newWidth = Math.max(200, Math.min(800, startWidth + deltaX));
    const newHeight = Math.max(240, Math.min(600, startHeight + deltaY));
    widget.style.width = `${newWidth}px`;
    widget.style.height = `${newHeight}px`;
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      saveWidgetSize(widget.offsetWidth, widget.offsetHeight);
      isResizing = false;
    }
  });
}

// Toggle minimize
function toggleMinimize(): void {
  const widget = document.getElementById('livescribe-widget');
  const content = document.getElementById('livescribe-content');
  const resizeHandle = document.getElementById('livescribe-resize-handle');
  const minimizeBtn = document.getElementById('livescribe-minimize');
  
  if (!widget || !content || !resizeHandle || !minimizeBtn) return;

  isMinimized = !isMinimized;
  saveMinimizedState(isMinimized);

  if (isMinimized) {
    widget.style.width = '120px';
    widget.style.height = '40px';
    content.style.display = 'none';
    resizeHandle.style.display = 'none';
    minimizeBtn.textContent = '▲';
  } else {
    const size = getWidgetSize();
    widget.style.width = `${size.width}px`;
    widget.style.height = `${size.height}px`;
    content.style.display = 'flex';
    resizeHandle.style.display = 'block';
    minimizeBtn.textContent = '▼';
  }
}

// Close widget
function closeWidget(): void {
  const widget = document.getElementById('livescribe-widget');
  if (widget) {
    widget.remove();
    if (isCapturing) {
      handleStop();
    }
  }
}

// Update transcript display
function updateTranscript() {
  const transcriptDiv = document.getElementById('livescribe-transcript');
  const transcriptTextDiv = document.getElementById('livescribe-transcript-text');
  const speakerDiv = document.getElementById('livescribe-speaker');
  
  if (!transcriptDiv || !transcriptTextDiv) return;

  const lines = transcriptReplicas.map((replica, index) => {
    const speaker = escapeHtml(replica.speaker);
    const text = escapeHtml(replica.text);
    const previousSpeaker = index > 0 ? transcriptReplicas[index - 1].speaker : null;
    const showSpeakerLabel = previousSpeaker !== replica.speaker;
    const highlightStyle = replica.highlighted === true
      ? 'border-left: 3px solid #0d9488; background: rgba(13,148,136,0.08); padding-left: 6px;'
      : '';

    return showSpeakerLabel
      ? `<div style="margin-bottom: 6px; ${highlightStyle}"><span style="font-weight: 600;">${speaker}:</span> ${text}</div>`
      : `<div style="margin-bottom: 6px; padding-left: 6px; ${highlightStyle}">${text}</div>`;
  });

  if (partialReplica && partialReplica.text.trim()) {
    const speaker = escapeHtml(partialReplica.speaker);
    const text = escapeHtml(partialReplica.text);
    lines.push(`<div style="margin-bottom: 6px; color: #6b7280; font-style: italic;"><span style="font-weight: 600;">${speaker}:</span> ${text}</div>`);
  }

  if (lines.length > 0) {
    if (speakerDiv) {
      speakerDiv.style.display = 'none';
    }
    transcriptTextDiv.innerHTML = lines.join('');
    transcriptDiv.scrollTop = transcriptDiv.scrollHeight;
    transcriptDiv.style.display = 'block';
  } else {
    transcriptDiv.style.display = 'none';
  }
}

// Update UI status
function updateStatus(status: 'idle' | 'recording' | 'error' | 'waiting', error?: string) {
  const statusDot = document.getElementById('livescribe-status');
  const statusText = document.getElementById('livescribe-status-text');
  const startBtn = document.getElementById('livescribe-start');
  const stopBtn = document.getElementById('livescribe-stop');
  const errorDiv = document.getElementById('livescribe-error');
  const languageSelect = document.getElementById('livescribe-language') as HTMLSelectElement | null;
  const modeSelect = document.getElementById('livescribe-audio-mode') as HTMLSelectElement | null;
  const audioLevelsContainer = document.getElementById('livescribe-audio-levels');

  if (!statusDot || !statusText || !startBtn || !stopBtn || !errorDiv) return;

  switch (status) {
    case 'recording':
      statusDot.style.background = '#ef4444';
      statusText.textContent = 'Recording';
      startBtn.style.display = 'none';
      stopBtn.style.display = 'block';
      errorDiv.style.display = 'none';
      if (languageSelect) {
        languageSelect.disabled = true;
        languageSelect.style.opacity = '0.5';
        languageSelect.style.cursor = 'not-allowed';
      }
      if (modeSelect) {
        modeSelect.disabled = true;
        modeSelect.style.opacity = '0.5';
        modeSelect.style.cursor = 'not-allowed';
      }
      if (audioLevelsContainer) {
        audioLevelsContainer.style.display = 'block';
      }
      renderWsRecoveryIndicator();
      renderAudioLevels();
      break;
    case 'waiting':
      statusDot.style.background = '#f59e0b';
      statusText.textContent = 'Waiting for audio...';
      startBtn.style.display = 'none';
      stopBtn.style.display = 'none';
      errorDiv.style.display = 'none';
      if (languageSelect) {
        languageSelect.disabled = true;
        languageSelect.style.opacity = '0.5';
        languageSelect.style.cursor = 'not-allowed';
      }
      if (modeSelect) {
        modeSelect.disabled = true;
        modeSelect.style.opacity = '0.5';
        modeSelect.style.cursor = 'not-allowed';
      }
      if (audioLevelsContainer) {
        audioLevelsContainer.style.display = 'none';
      }
      renderWsRecoveryIndicator();
      break;
    case 'error':
      statusDot.style.background = '#ef4444';
      statusText.textContent = 'Error';
      startBtn.style.display = 'block';
      stopBtn.style.display = 'none';
      if (languageSelect) {
        languageSelect.disabled = false;
        languageSelect.style.opacity = '1';
        languageSelect.style.cursor = 'pointer';
      }
      if (modeSelect) {
        modeSelect.disabled = false;
        modeSelect.style.opacity = '1';
        modeSelect.style.cursor = 'pointer';
      }
      if (error) {
        errorDiv.textContent = error;
        errorDiv.style.display = 'block';
      }
      if (audioLevelsContainer) {
        audioLevelsContainer.style.display = 'none';
      }
      renderWsRecoveryIndicator();
      break;
    default:
      statusDot.style.background = '#9ca3af';
      statusText.textContent = 'Ready';
      startBtn.style.display = 'block';
      stopBtn.style.display = 'none';
      errorDiv.style.display = 'none';
      if (languageSelect) {
        languageSelect.disabled = false;
        languageSelect.style.opacity = '1';
        languageSelect.style.cursor = 'pointer';
      }
      if (modeSelect) {
        modeSelect.disabled = false;
        modeSelect.style.opacity = '1';
        modeSelect.style.cursor = 'pointer';
      }
      if (audioLevelsContainer) {
        audioLevelsContainer.style.display = 'none';
      }
      renderWsRecoveryIndicator();
  }
}

// Start capture - delegate to service worker + offscreen document
async function handleStart() {
  if (!recordingController) return;
  await recordingController.start();
  if (isCapturing && !recordingStartedAtMs) {
    recordingStartedAtMs = Date.now();
    startMetricsTicker();
    renderAudioMetrics();
  }
}

// Stop capture
async function handleStop() {
  if (!recordingController) return;
  await recordingController.stop();
  wsRecovering = false;
  clearRecoveredToast();
  renderWsRecoveryIndicator();
}

async function handleReset() {
  clearTranscriptState();
  resetAudioMetrics();
  resetAudioLevels();
  wsRecovering = false;
  clearRecoveredToast();
  renderWsRecoveryIndicator();

  chrome.runtime.sendMessage(
    {
      type: 'RESET_RECORDING_STATE',
      keepRunning: isCapturing,
    },
    (response) => {
      if (chrome.runtime.lastError || !response) {
        return;
      }

      applyAudioMetrics({
        recordingStartedAtMs: response.recordingStartedAtMs,
        recordingSeconds: response.recordingSeconds,
        deepgramSeconds: response.deepgramSeconds,
      });
    },
  );
}


// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'CONTENT_START') {
    handleStart().then(() => sendResponse({ success: true })).catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'CONTENT_STOP') {
    handleStop();
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'CONTENT_GET_STATUS') {
    sendResponse({
      status: isCapturing ? 'recording' : 'idle',
      sessionId: contentSessionId,
      recordingStartedAtMs,
      recordingSeconds: getCurrentRecordingSeconds(),
      deepgramSeconds: deepgramAudioSeconds,
    });
    return true;
  }

  if (message.type === 'CONTENT_AUDIO_METRICS') {
    applyAudioMetrics({
      recordingStartedAtMs: message.recordingStartedAtMs,
      recordingSeconds: message.recordingSeconds,
      deepgramSeconds: message.deepgramSeconds,
    });

    return false;
  }

  if (message.type === 'CONTENT_AUDIO_LEVELS') {
    applyAudioLevelsSnapshot({
      mode: message.mode,
      mixed: message.mixed,
      speakers: message.speakers,
    });
    return false;
  }

  if (message.type === 'CONTENT_WS_RECOVERY_STATUS') {
    const wasRecovering = wsRecovering;
    wsRecovering = message.recovering === true;
    if (wasRecovering && !wsRecovering && isCapturing) {
      showRecoveredToast(3000);
      return false;
    }
    renderWsRecoveryIndicator();
    return false;
  }

  if (message.type === 'CONTENT_TOGGLE_WIDGET') {
    const widget = document.getElementById('livescribe-widget');
    if (widget) {
      widget.remove();
      console.log('Widget hidden');
      sendResponse({ success: true, action: 'hidden' });
    } else {
      console.log('Creating widget...');
      createUIWidget();
      console.log('Widget created');
      sendResponse({ success: true, action: 'shown' });
    }
    return true;
  }

  // Handle WebSocket messages forwarded from service worker
  if (message.type === 'WS_MESSAGE') {
    const wsMessage = message.message;
    console.log('Received transcript:', wsMessage);

    if (wsMessage.type === 'partial') {
      if (typeof (wsMessage as any).speaker === 'string') {
        currentSpeaker = (wsMessage as any).speaker;
      }

      const speaker = normalizeSpeaker((wsMessage as any).speaker ?? currentSpeaker);
      const text = (wsMessage.text || '').trim();
      const eventTimestamp = typeof wsMessage.timestamp === 'number' ? wsMessage.timestamp : Date.now();

      if (
        partialReplica &&
        partialReplica.text.trim() &&
        partialReplica.speaker !== speaker
      ) {
        appendTranscriptReplica(partialReplica.speaker, partialReplica.text, eventTimestamp);
      }

      partialReplica = text
        ? { speaker, text }
        : null;

      updateTranscript();
    } else if (wsMessage.type === 'final') {
      if (typeof (wsMessage as any).speaker === 'string') {
        currentSpeaker = (wsMessage as any).speaker;
      }

      const text = (wsMessage.text || '').trim();
      const speaker = normalizeSpeaker((wsMessage as any).speaker ?? currentSpeaker);
      const eventTimestamp = typeof wsMessage.timestamp === 'number' ? wsMessage.timestamp : Date.now();

      if (
        partialReplica &&
        partialReplica.text.trim() &&
        partialReplica.speaker !== speaker
      ) {
        appendTranscriptReplica(partialReplica.speaker, partialReplica.text, eventTimestamp);
      }

      if (text) {
        appendTranscriptReplica(speaker, text, eventTimestamp);
      }

      partialReplica = null;
      updateTranscript();
    } else if (wsMessage.type === 'status' && wsMessage.sessionId) {
      contentSessionId = wsMessage.sessionId;
      trackModeController.ensureStarted('ws:status');
    }
    return false;
  }

  return false;
});

