import type { AuthResponse, LoginRequest, RegisterRequest, PersonalTokenDTO } from '@livescribe/shared';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { const body = await res.json(); if (body?.error) message = body.error; } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const getMe = () => req<AuthResponse>('/auth/me');
export const login = (body: LoginRequest) => req<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(body) });
export const register = (body: RegisterRequest) => req<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(body) });
export const logout = () => req<{ ok: true }>('/auth/logout', { method: 'POST' });
export const listTokens = () => req<PersonalTokenDTO[]>('/tokens');
export const createToken = (label?: string) => req<PersonalTokenDTO>('/tokens', { method: 'POST', body: JSON.stringify({ label }) });
export const deleteToken = (id: string) => req<{ ok: true }>(`/tokens/${id}`, { method: 'DELETE' });
