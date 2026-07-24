import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { login } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import styles from './AuthPage.module.scss';

export function LoginPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ email, password });
      await refresh();
      navigate('/');
    } catch (err) {
      setError((err as Error).message === 'invalid_credentials' ? 'Неверный email или пароль' : 'Не удалось войти');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={onSubmit}>
        <div className={styles.brand}>Skribo</div>
        <h1 className={styles.title}>Вход</h1>
        <TextField
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <TextField
          id="password"
          label="Пароль"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && <span className={styles.formError}>{error}</span>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Вход…' : 'Войти'}
        </Button>
        <div className={styles.switch}>
          Нет аккаунта? <Link to="/register">Регистрация</Link>
        </div>
      </form>
    </div>
  );
}
