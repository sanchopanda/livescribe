/**
 * Remembering that the user signed out on purpose.
 *
 * Signing out only cleared the stored token, and the popup treats "no token" as "never signed in":
 * on the next open it auto-detects the cabinet session and issues a fresh token, so the user is
 * logged straight back in and the button looks broken. Auto-detect needs to tell the two states
 * apart, which means the deliberate sign-out has to be recorded.
 *
 * Storage is injected so this is testable without a browser.
 */

export const AUTH_OPT_OUT_KEY = 'skriboAuthOptOut';

export interface OptOutStorage {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

/** Record that the user signed out, so auto-detect stays quiet. */
export async function markSignedOut(storage: OptOutStorage): Promise<void> {
  await storage.set({ [AUTH_OPT_OUT_KEY]: true });
}

/** Undo it — the user is signing in again, deliberately. */
export async function clearSignedOut(storage: OptOutStorage): Promise<void> {
  await storage.remove(AUTH_OPT_OUT_KEY);
}

/**
 * Whether the user has signed out and has not asked to come back.
 *
 * A storage failure resolves to `false`: the worst case is one unwanted auto-login, whereas
 * throwing here would leave the popup stuck.
 */
export async function hasSignedOut(storage: OptOutStorage): Promise<boolean> {
  try {
    const stored = await storage.get(AUTH_OPT_OUT_KEY);
    return stored?.[AUTH_OPT_OUT_KEY] === true;
  } catch {
    return false;
  }
}
