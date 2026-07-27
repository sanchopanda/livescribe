import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { UserDTO } from '@skribo/shared';
import { getMe, logout as apiLogout } from '../api';

type Status = 'loading' | 'authed' | 'guest';
interface AuthValue { status: Status; me: UserDTO | null; refresh: () => Promise<void>; signOut: () => Promise<void>; }

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<UserDTO | null>(null);

  const refresh = useCallback(async () => {
    try { const r = await getMe(); setMe(r.user); setStatus('authed'); }
    catch { setMe(null); setStatus('guest'); }
  }, []);
  const signOut = useCallback(async () => {
    await apiLogout().catch(() => undefined); setMe(null); setStatus('guest');
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return <Ctx.Provider value={{ status, me, refresh, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth вне AuthProvider');
  return v;
}
