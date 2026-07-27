import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../api';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import styles from './AuthPage.module.scss';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await forgotPassword(email);
      setMessage('Если аккаунт с таким email существует, мы отправили ссылку для сброса пароля');
    } catch {
      setError('Не удалось отправить запрос. Проверьте соединение и попробуйте снова');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={onSubmit}>
        <div className={styles.brand}>Skribo</div>
        <h1 className={styles.title}>Восстановление пароля</h1>
        <TextField
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          disabled={busy || !!message}
        />
        {message && <span className={styles.formSuccess}>{message}</span>}
        {error && <span className={styles.formError}>{error}</span>}
        {!message && (
          <Button type="submit" disabled={busy}>
            {busy ? 'Отправка…' : 'Отправить ссылку'}
          </Button>
        )}
        <div className={styles.switch}>
          <Link to="/login">← Ко входу</Link>
        </div>
      </form>
    </div>
  );
}
