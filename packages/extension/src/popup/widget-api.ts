import {
  CONTENT_WIDGET_STATE,
  TOGGLE_WIDGET_IN_ACTIVE_TAB,
  type WidgetStateResult,
  type WidgetToggleResult,
} from '../messaging/widget-messages';

/**
 * Widget state in the active tab. Null when it can't be determined — no active tab, or a page
 * the content script does not run on (chrome://, the Web Store, a plain website).
 */
export async function readWidgetState(): Promise<WidgetStateResult | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    const state = (await chrome.tabs.sendMessage(tab.id, {
      type: CONTENT_WIDGET_STATE,
    })) as WidgetStateResult | undefined;
    return state ?? null;
  } catch {
    return null;
  }
}

export async function toggleWidget(): Promise<WidgetToggleResult> {
  try {
    return ((await chrome.runtime.sendMessage({
      type: TOGGLE_WIDGET_IN_ACTIVE_TAB,
    })) as WidgetToggleResult) ?? { error: 'no_content_script' };
  } catch {
    return { error: 'no_content_script' };
  }
}
