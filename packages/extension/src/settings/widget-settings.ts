// User-facing widget settings, stored in chrome.storage.local and shared by the popup
// (which edits them) and the content script (which reads them on every page load).

export const AUTO_SHOW_WIDGET_KEY = 'skriboAutoShowWidget';

/** Auto-show is opt-in: by default the widget appears only from the popup button. */
export const AUTO_SHOW_WIDGET_DEFAULT = false;

export async function getAutoShowWidget(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(AUTO_SHOW_WIDGET_KEY);
    const value = stored[AUTO_SHOW_WIDGET_KEY];
    return typeof value === 'boolean' ? value : AUTO_SHOW_WIDGET_DEFAULT;
  } catch {
    return AUTO_SHOW_WIDGET_DEFAULT;
  }
}

export async function setAutoShowWidget(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [AUTO_SHOW_WIDGET_KEY]: enabled });
}
