import { clearSignedOut, hasSignedOut, markSignedOut } from './auth-optout';

declare const __API_URL__: string;
declare const __CABINET_URL__: string;

export interface Account {
  email: string;
  via: 'cabinet' | 'login';
}

async function jsonOrNull(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// auto-detect: cabinet session → extension token.
// Best-effort: cross-origin credentialed fetch from an extension may be blocked or hang,
// so we cap each request with a short timeout and fall back to the login form on any failure.
async function fetchWithTimeout(url: string, init: RequestInit, ms = 2500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function tryAutoDetect(): Promise<Account | null> {
  // A deliberate sign-out must survive reopening the popup: "no token" alone cannot tell
  // "never signed in" from "signed out on purpose".
  if (await hasSignedOut(chrome.storage.local)) return null;

  try {
    const me = await fetchWithTimeout(`${__CABINET_URL__}/api/auth/me`, { credentials: 'include' });
    if (!me.ok) return null;
    const meBody = await jsonOrNull(me);
    const tok = await fetchWithTimeout(`${__CABINET_URL__}/api/auth/extension-token`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!tok.ok) return null;
    const { token } = await jsonOrNull(tok);
    if (!token) return null;
    await chrome.storage.local.set({ skriboToken: token, skriboAccountEmail: meBody?.user?.email ?? null });
    return { email: meBody?.user?.email ?? '', via: 'cabinet' };
  } catch {
    return null;
  }
}

export async function loginWithPassword(email: string, password: string): Promise<Account> {
  const res = await fetch(`${__API_URL__}/api/auth/extension-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const b = await jsonOrNull(res);
    throw new Error(b?.error || `HTTP ${res.status}`);
  }
  const { user, token } = await jsonOrNull(res);
  await chrome.storage.local.set({ skriboToken: token, skriboAccountEmail: user?.email ?? null });
  // Signing in with a password is as deliberate as it gets — the earlier sign-out no longer holds.
  await clearSignedOut(chrome.storage.local);
  return { email: user?.email ?? email, via: 'login' };
}

export async function currentAccount(): Promise<string | null> {
  const { skriboAccountEmail } = await chrome.storage.local.get('skriboAccountEmail');
  return typeof skriboAccountEmail === 'string' ? skriboAccountEmail : null;
}

export async function signOut(): Promise<void> {
  await chrome.storage.local.remove(['skriboToken', 'skriboAccountEmail']);
  // Without this the next popup open auto-detects the still-valid cabinet session and signs the
  // user straight back in, which makes the button look broken.
  await markSignedOut(chrome.storage.local);
}

/**
 * Sign back in through the cabinet session, without a password. This is the deliberate act that
 * cancels a previous sign-out.
 */
export async function reconnectCabinetAccount(): Promise<Account | null> {
  await clearSignedOut(chrome.storage.local);
  return tryAutoDetect();
}
