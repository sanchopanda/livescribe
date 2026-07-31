// Messages exchanged between the popup, the service worker and the in-page widget.

/** Popup → service worker: toggle the widget in the currently active tab. */
export const TOGGLE_WIDGET_IN_ACTIVE_TAB = 'TOGGLE_WIDGET_IN_ACTIVE_TAB';

/** Popup → content script: is the widget currently on the page, and on which platform? */
export const CONTENT_WIDGET_STATE = 'CONTENT_WIDGET_STATE';

export type WidgetToggleError = 'no_tab' | 'no_content_script' | 'unsupported_page';

export interface WidgetToggleResult {
  action?: 'shown' | 'hidden';
  error?: WidgetToggleError;
}

export interface WidgetStateResult {
  visible: boolean;
  platform: string | null;
}
