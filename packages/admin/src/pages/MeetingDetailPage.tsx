import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { MeetingDetailDTO } from '@livescribe/shared';
import { getMeeting } from '../api';
import { formatDate, formatDuration, platformLabel } from '../lib/format';
import styles from './MeetingDetailPage.module.scss';

type Status = 'loading' | 'ready' | 'notfound' | 'error';

export function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [meeting, setMeeting] = useState<MeetingDetailDTO | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    if (!id) return;
    setStatus('loading');
    getMeeting(id)
      .then((m) => { setMeeting(m); setStatus('ready'); })
      .catch((err) => setStatus((err as Error).message === 'not_found' ? 'notfound' : 'error'));
  }, [id]);

  if (status === 'loading') return <div className={styles.page}><p className="muted">Загрузка…</p></div>;
  if (status === 'notfound') return <div className={styles.page}><p className="muted">Встреча не найдена.</p><Link to="/">← К списку</Link></div>;
  if (status === 'error' || !meeting) return <div className={styles.page}><p className={styles.error}>Не удалось загрузить встречу.</p><Link to="/">← К списку</Link></div>;

  return (
    <div className={styles.page}>
      <Link to="/" className={styles.back}>← Переговоры</Link>
      <h1 className={styles.title}>{meeting.title || platformLabel(meeting.platform)}</h1>
      <div className={styles.meta}>
        <span>{platformLabel(meeting.platform)}</span>
        <span>·</span><span>{formatDate(meeting.startedAt)}</span>
        <span>·</span><span>{formatDuration(meeting.durationSec)}</span>
        {meeting.participantsCount ? (<><span>·</span><span>{meeting.participantsCount} уч.</span></>) : null}
      </div>

      <div className={styles.body}>
        <section className={styles.transcript}>
          <h2 className={styles.sectionTitle}>Транскрипт</h2>
          {meeting.segments.length === 0 ? (
            <p className="muted">Пусто.</p>
          ) : (
            <ul className={styles.segments}>
              {meeting.segments.map((s) => (
                <li key={s.id} className={styles.segment}>
                  <span className={styles.speaker}>{s.speaker || 'Спикер'}</span>
                  <span className={styles.text}>{s.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className={styles.analysis}>
          <h2 className={styles.sectionTitle}>Анализ</h2>
          {meeting.analysis?.summary ? (
            <p>{meeting.analysis.summary}</p>
          ) : (
            <p className="muted">Анализ появится позже.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
