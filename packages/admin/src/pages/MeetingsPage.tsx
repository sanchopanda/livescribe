import { useEffect, useRef, useState } from 'react';
import type { MeetingDTO } from '@livescribe/shared';
import { listMeetings } from '../api';
import { formatDate, formatDuration, platformLabel } from '../lib/format';
import { Button } from '../ui/Button';
import styles from './MeetingsPage.module.scss';

type Status = 'loading' | 'ready' | 'error';

export function MeetingsPage() {
  const [meetings, setMeetings] = useState<MeetingDTO[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [reload, setReload] = useState(0);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    setStatus('loading');
    const t = setTimeout(() => {
      listMeetings({ q: q.trim() || undefined, sort })
        .then((list) => {
          if (id === reqId.current) {
            setMeetings(list);
            setStatus('ready');
          }
        })
        .catch(() => {
          if (id === reqId.current) setStatus('error');
        });
    }, 300);
    return () => clearTimeout(t);
  }, [q, sort, reload]);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Переговоры</h1>
      <div className={styles.controls}>
        <input
          className={styles.search}
          placeholder="Поиск по названию…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className={styles.sort}
          value={sort}
          onChange={(e) => setSort(e.target.value as 'newest' | 'oldest')}
        >
          <option value="newest">Сначала новые</option>
          <option value="oldest">Сначала старые</option>
        </select>
      </div>

      {status === 'loading' && <p className="muted">Загрузка…</p>}

      {status === 'error' && (
        <p className={styles.error}>
          Не удалось загрузить.{' '}
          <Button type="button" variant="ghost" onClick={() => setReload((n) => n + 1)}>
            Повторить
          </Button>
        </p>
      )}

      {status === 'ready' && meetings.length === 0 && (
        <p className="muted">
          {q.trim() ? 'Ничего не найдено' : 'Пока нет переговоров. Начните запись в расширении.'}
        </p>
      )}

      {status === 'ready' && meetings.length > 0 && (
        <ul className={styles.list}>
          {meetings.map((m) => (
            <li key={m.id} className={styles.card}>
              <div className={styles.cardTitle}>{m.title || platformLabel(m.platform)}</div>
              <div className={styles.cardMeta}>
                <span>{platformLabel(m.platform)}</span>
                <span>·</span>
                <span>{formatDate(m.startedAt)}</span>
                <span>·</span>
                <span>{formatDuration(m.durationSec)}</span>
                {m.participantsCount ? (
                  <>
                    <span>·</span>
                    <span>{m.participantsCount} уч.</span>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
