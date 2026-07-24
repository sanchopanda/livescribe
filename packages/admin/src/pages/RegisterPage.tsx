import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { register } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import styles from './AuthPage.module.scss';

export function RegisterPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({ email, password, name: name || undefined });
      await refresh();
      navigate('/');
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'email_taken') setError('Email уже занят');
      else if (message === 'invalid_input') setError('Пароль от 8 символов');
      else setError('Не удалось зарегистрироваться');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={onSubmit}>
        <div className={styles.brand}>Skribo</div>
        <h1 className={styles.title}>Регистрация</h1>
        <TextField id="name" label="Имя" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          id="email"
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <TextField
          id="password"
          label="Пароль"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <span className={styles.formError}>{error}</span>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Регистрация…' : 'Зарегистрироваться'}
        </Button>
        <div className={styles.switch}>
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </div>
      </form>
    </div>
  );
}
