import { useEffect, useState, type FormEvent } from 'react';
import { currentAccount, loginWithPassword, signOut, tryAutoDetect } from './auth-api';
import { readWidgetState, toggleWidget } from './widget-api';
import { AUTO_SHOW_WIDGET_DEFAULT, getAutoShowWidget, setAutoShowWidget } from '../settings/widget-settings';
import type { WidgetToggleError } from '../messaging/widget-messages';

declare const __CABINET_URL__: string;

type Status = 'loading' | 'authed' | 'guest';

const SUPPORTED_PLATFORMS = 'Meet, Zoom, Teams, Pachca';

function widgetErrorMessage(code: WidgetToggleError): string {
  if (code === 'no_tab') return 'Не найдена активная вкладка';
  return `Виджет доступен только на странице звонка (${SUPPORTED_PLATFORMS})`;
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

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
  const [showPassword, setShowPassword] = useState(false);
  const [widgetVisible, setWidgetVisible] = useState(false);
  const [onCallPage, setOnCallPage] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [autoShow, setAutoShow] = useState(AUTO_SHOW_WIDGET_DEFAULT);

  useEffect(() => {
    let cancelled = false;

    async function initWidgetControls() {
      const [state, enabled] = await Promise.all([readWidgetState(), getAutoShowWidget()]);
      if (cancelled) return;
      setWidgetVisible(state?.visible === true);
      setOnCallPage(Boolean(state?.platform));
      setAutoShow(enabled);
    }

    void initWidgetControls();
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function handleToggleWidget() {
    setWidgetError(null);
    const result = await toggleWidget();
    if (result.error) {
      setWidgetError(widgetErrorMessage(result.error));
      return;
    }
    setWidgetVisible(result.action === 'shown');
    setOnCallPage(true);
  }

  async function handleAutoShowChange(enabled: boolean) {
    setAutoShow(enabled);
    await setAutoShowWidget(enabled);
    // Switching it on mounts the widget right away on an open call page.
    if (enabled && onCallPage) setWidgetVisible(true);
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
        <button type="button" className="skribo-button" onClick={handleToggleWidget}>
          {widgetVisible ? 'Скрыть виджет' : 'Показать виджет'}
        </button>
        {widgetError && <p className="skribo-error">{widgetError}</p>}
        <label className="skribo-setting">
          <input
            type="checkbox"
            checked={autoShow}
            onChange={(e) => void handleAutoShowChange(e.target.checked)}
          />
          <span>
            Показывать виджет автоматически
            <span className="skribo-hint">на страницах звонков ({SUPPORTED_PLATFORMS})</span>
          </span>
        </label>
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
        <div className="skribo-input-wrap">
          <input
            id="skribo-password"
            className="skribo-input skribo-input--with-toggle"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <button
            type="button"
            className="skribo-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
            title={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
          >
            <EyeIcon off={showPassword} />
          </button>
        </div>
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
