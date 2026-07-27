import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../api';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import styles from './AuthPage.module.scss';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showRequestAgain, setShowRequestAgain] = useState(false);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <div className={styles.brand}>Skribo</div>
          <h1 className={styles.title}>Сброс пароля</h1>
          <span className={styles.formError}>Ссылка недействительна</span>
          <div className={styles.switch}>
            <Link to="/forgot">Запросить снова</Link>
          </div>
        </div>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setShowRequestAgain(false);
    if (password.length < 8) {
      setError('Пароль должен быть не короче 8 символов');
      return;
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token as string, password);
      setSuccess(true);
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'weak_password') {
        setError('Пароль должен быть не короче 8 символов');
      } else if (message === 'invalid_or_expired') {
        setError('Ссылка недействительна или истекла');
        setShowRequestAgain(true);
      } else {
        setError('Не удалось сбросить пароль. Попробуйте снова');
      }
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <div className={styles.brand}>Skribo</div>
          <h1 className={styles.title}>Сброс пароля</h1>
          <span className={styles.formSuccess}>Пароль изменён. Теперь вы можете войти</span>
          <div className={styles.switch}>
            <Link to="/login">Ко входу</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={onSubmit}>
        <div className={styles.brand}>Skribo</div>
        <h1 className={styles.title}>Сброс пароля</h1>
        <TextField
          id="password"
          label="Новый пароль"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          disabled={busy}
        />
        <TextField
          id="confirmPassword"
          label="Повторите пароль"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
          disabled={busy}
        />
        {error && <span className={styles.formError}>{error}</span>}
        {showRequestAgain && (
          <div className={styles.switch}>
            <Link to="/forgot">Запросить снова</Link>
          </div>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? 'Сохранение…' : 'Сохранить пароль'}
        </Button>
      </form>
    </div>
  );
}
