import { useCallback, useEffect, useState } from 'react';
import type { PersonalTokenDTO } from '@livescribe/shared';
import { createToken, deleteToken, listTokens } from '../api';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../ui/Button';
import styles from './SettingsPage.module.scss';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

export function SettingsPage() {
  const { me } = useAuth();
  const [tokens, setTokens] = useState<PersonalTokenDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTokens(await listTokens());
    } catch {
      setError('Не удалось загрузить токены');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreate() {
    setCreating(true);
    setError(null);
    setCopied(false);
    try {
      const t = await createToken();
      setNewToken(t.token ?? null);
      await refresh();
    } catch {
      setError('Не удалось создать токен');
    } finally {
      setCreating(false);
    }
  }

  async function onCopy() {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
    } catch {
      setError('Не удалось скопировать токен');
    }
  }

  async function onDelete(id: string) {
    setError(null);
    try {
      await deleteToken(id);
      await refresh();
    } catch {
      setError('Не удалось удалить токен');
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Настройки</h1>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Профиль</h2>
        <div className={styles.profile}>
          <div className={styles.profileRow}>
            <span className={styles.profileLabel}>Email</span>
            <span className={styles.profileValue}>{me?.email}</span>
          </div>
          <div className={styles.profileRow}>
            <span className={styles.profileLabel}>Имя</span>
            <span className={styles.profileValue}>{me?.name || '—'}</span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Расширение</h2>
        <p className={styles.hint}>
          Вставьте токен в расширение Skribo, чтобы переговоры сохранялись в вашем аккаунте.
        </p>

        {error && <div className={styles.formError}>{error}</div>}

        {newToken && (
          <div className={styles.newToken}>
            <code className={styles.tokenValue}>{newToken}</code>
            <Button type="button" variant="ghost" onClick={onCopy}>
              {copied ? 'Скопировано' : 'Скопировать'}
            </Button>
            <div className={styles.newTokenNote}>Скопируйте сейчас — больше не покажем.</div>
          </div>
        )}

        <Button type="button" onClick={onCreate} disabled={creating}>
          {creating ? 'Создание…' : 'Создать токен'}
        </Button>

        <div className={styles.list}>
          {loading && <div className={styles.empty}>Загрузка…</div>}
          {!loading && tokens.length === 0 && <div className={styles.empty}>Пока нет токенов.</div>}
          {!loading &&
            tokens.map((t) => (
              <div key={t.id} className={styles.item}>
                <div className={styles.itemInfo}>
                  <span className={styles.itemLabel}>{t.label || 'Без названия'}</span>
                  <span className={styles.itemDate}>Создан {formatDate(t.createdAt)}</span>
                </div>
                <Button type="button" variant="ghost" onClick={() => void onDelete(t.id)}>
                  Удалить
                </Button>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
