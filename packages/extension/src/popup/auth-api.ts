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

// auto-detect: cabinet session → extension token
export async function tryAutoDetect(): Promise<Account | null> {
  try {
    const me = await fetch(`${__CABINET_URL__}/api/auth/me`, { credentials: 'include' });
    if (!me.ok) return null;
    const meBody = await jsonOrNull(me);
    const tok = await fetch(`${__CABINET_URL__}/api/auth/extension-token`, {
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
  return { email: user?.email ?? email, via: 'login' };
}

export async function currentAccount(): Promise<string | null> {
  const { skriboAccountEmail } = await chrome.storage.local.get('skriboAccountEmail');
  return typeof skriboAccountEmail === 'string' ? skriboAccountEmail : null;
}

export async function signOut(): Promise<void> {
  await chrome.storage.local.remove(['skriboToken', 'skriboAccountEmail']);
}
