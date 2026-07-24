import { useEffect, useState, type FormEvent } from 'react';
import { currentAccount, loginWithPassword, signOut, tryAutoDetect } from './auth-api';

declare const __CABINET_URL__: string;

type Status = 'loading' | 'authed' | 'guest';

function errorMessage(err: unknown): string {
  const code = err instanceof Error ? err.message : String(err);
  if (code === 'invalid_credentials') return 'Неверный email или пароль';
  if (code === 'invalid_input') return 'Заполните поля';
  return 'Не удалось войти. Попробуйте ещё раз.';
}

export default function App() {
  const [status, setStatus] = useState<Status>('loading');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const { skriboToken } = await chrome.storage.local.get('skriboToken');
        const storedEmail = await currentAccount();
        if (typeof skriboToken === 'string' && skriboToken && storedEmail) {
          if (!cancelled) {
            setEmail(storedEmail);
            setStatus('authed');
          }
          return;
        }

        const detected = await tryAutoDetect();
        if (cancelled) return;
        if (detected) {
          setEmail(detected.email);
          setStatus('authed');
        } else {
          setStatus('guest');
        }
      } catch {
        // never leave the popup stuck on "loading" — drop to the login form
        if (!cancelled) setStatus('guest');
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const account = await loginWithPassword(email, password);
      setEmail(account.email);
      setPassword('');
      setStatus('authed');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    setEmail('');
    setPassword('');
    setError(null);
    setStatus('guest');
  }

  if (status === 'loading') {
    return (
      <div className="skribo-popup">
        <p className="skribo-loading">Проверяем аккаунт…</p>
      </div>
    );
  }

  if (status === 'authed') {
    return (
      <div className="skribo-popup">
        <h1 className="skribo-title">Skribo</h1>
        <p className="skribo-account">
          Вошли как <strong>{email}</strong>
        </p>
        <a
          className="skribo-link"
          href={__CABINET_URL__}
          target="_blank"
          rel="noreferrer"
        >
          Открыть кабинет
        </a>
        <button type="button" className="skribo-button skribo-button--secondary" onClick={handleSignOut}>
          Выйти
        </button>
      </div>
    );
  }

  return (
    <div className="skribo-popup">
      <h1 className="skribo-title">Skribo</h1>
      <form className="skribo-form" onSubmit={handleSubmit}>
        <label className="skribo-label" htmlFor="skribo-email">
          Email
        </label>
        <input
          id="skribo-email"
          className="skribo-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
        <label className="skribo-label" htmlFor="skribo-password">
          Пароль
        </label>
        <input
          id="skribo-password"
          className="skribo-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && <p className="skribo-error">{error}</p>}
        <button type="submit" className="skribo-button" disabled={submitting}>
          {submitting ? 'Входим…' : 'Войти'}
        </button>
      </form>
      <a className="skribo-link" href={__CABINET_URL__} target="_blank" rel="noreferrer">
        Регистрация в кабинете
      </a>
    </div>
  );
}
