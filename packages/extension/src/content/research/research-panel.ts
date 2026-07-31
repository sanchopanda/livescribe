// "🔬 Research (dev)" section of the in-page widget. Rendered only in dev builds — the entry
// point checks __DEV_TOOLS__ before calling in.

import { collectSnapshot } from './probe-bridge';
import { buildReport, reportFileName, summarizeSnapshot, type Snapshot } from './report-builder';

const PANEL_ID = 'skribo-research-panel';
const STATUS_ID = 'skribo-research-status';
const COLLECT_ID = 'skribo-research-collect';
const DOWNLOAD_ID = 'skribo-research-download';
const COPY_ID = 'skribo-research-copy';

export interface ResearchPanelContext {
  getPlatform: () => string | null;
  getDomSpeaker: () => { participantId: string; speaker: string | null } | null;
}

const snapshots: Snapshot[] = [];

export function researchPanelHtml(): string {
  return `
    <div id="${PANEL_ID}" style="
      margin-top: 8px;
      padding: 6px;
      border: 1px dashed #c4b5fd;
      border-radius: 4px;
      background: #faf5ff;
      font-size: 11px;
      color: #4c1d95;
    ">
      <div style="font-weight: 600; margin-bottom: 4px;">🔬 Research (dev)</div>
      <div id="${STATUS_ID}" style="margin-bottom: 4px;">снимков: 0</div>
      <div style="display: flex; gap: 4px; flex-wrap: wrap;">
        <button id="${COLLECT_ID}" style="flex: 1; min-width: 90px; padding: 4px 6px; border: none; border-radius: 4px; background: #7c3aed; color: white; cursor: pointer; font-size: 11px;">Собрать снимок</button>
        <button id="${DOWNLOAD_ID}" style="padding: 4px 6px; border: none; border-radius: 4px; background: #ede9fe; color: #4c1d95; cursor: pointer; font-size: 11px;">Скачать</button>
        <button id="${COPY_ID}" style="padding: 4px 6px; border: none; border-radius: 4px; background: #ede9fe; color: #4c1d95; cursor: pointer; font-size: 11px;">Копировать</button>
      </div>
    </div>
  `;
}

function setStatus(text: string): void {
  const el = document.getElementById(STATUS_ID);
  if (el) el.textContent = text;
}

function describe(snapshot: Snapshot): string {
  const s = summarizeSnapshot(snapshot);
  const speaker = snapshot.domSpeaker?.speaker ?? '—';
  const parts = [
    `снимков: ${snapshots.length}`,
    `PC: ${s.peerConnections}`,
    `audio-in: ${s.inboundAudio} (активных ${s.activeInboundAudio})`,
    `говорит: ${speaker}`,
  ];
  if (snapshot.bridgeTimeout) parts.push('⚠ MAIN-мир не ответил');
  if (snapshot.scan.truncated) parts.push(`⚠ скан обрезан на ${snapshot.scan.scannedElements}`);
  return parts.join(' · ');
}

function currentReport(): string {
  return JSON.stringify(
    buildReport(snapshots[0]?.platform ?? null, window.location.href, snapshots),
    null,
    2,
  );
}

export function setupResearchPanel(context: ResearchPanelContext): void {
  document.getElementById(COLLECT_ID)?.addEventListener('click', async () => {
    setStatus('собираю…');
    try {
      const snapshot = await collectSnapshot({
        index: snapshots.length,
        platform: context.getPlatform(),
        domSpeaker: context.getDomSpeaker(),
      });
      snapshots.push(snapshot);
      setStatus(describe(snapshot));
      console.log('[Skribo][research] snapshot', snapshot);
    } catch (err) {
      setStatus(`ошибка: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  document.getElementById(DOWNLOAD_ID)?.addEventListener('click', () => {
    if (snapshots.length === 0) {
      setStatus('нечего скачивать — сначала соберите снимок');
      return;
    }
    const blob = new Blob([currentReport()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = reportFileName(snapshots[0].platform, snapshots[0].takenAt);
    link.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById(COPY_ID)?.addEventListener('click', async () => {
    if (snapshots.length === 0) {
      setStatus('нечего копировать — сначала соберите снимок');
      return;
    }
    try {
      await navigator.clipboard.writeText(currentReport());
      setStatus(`скопировано (снимков: ${snapshots.length})`);
    } catch {
      // Clipboard can be blocked by the page's permissions policy — the console copy still works.
      console.log('[Skribo][research] report', currentReport());
      setStatus('буфер недоступен — отчёт выведен в консоль');
    }
  });
}
