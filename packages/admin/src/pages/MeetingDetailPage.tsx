import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { MeetingDetailDTO, AnalysisDTO } from '@skribo/shared';
import { getMeeting, analyzeMeeting } from '../api';
import { formatDate, formatDuration, platformLabel } from '../lib/format';
import styles from './MeetingDetailPage.module.scss';

type Status = 'loading' | 'ready' | 'notfound' | 'error';

export function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [meeting, setMeeting] = useState<MeetingDetailDTO | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [analysis, setAnalysis] = useState<AnalysisDTO | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setStatus('loading');
    getMeeting(id)
      .then((m) => { setMeeting(m); setAnalysis(m.analysis); setStatus('ready'); })
      .catch((err) => setStatus((err as Error).message === 'not_found' ? 'notfound' : 'error'));
  }, [id]);

  async function runAnalysis() {
    if (!id) return;
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const a = await analyzeMeeting(id);
      setAnalysis(a);
    } catch (e) {
      const code = (e as Error).message;
      setAnalysisError(
        code === 'analysis_unavailable' ? 'Анализ недоступен: не настроен LLM-ключ.'
          : code === 'no_transcript' ? 'Нет транскрипта для анализа.'
          : 'Не удалось проанализировать. Попробуйте ещё раз.'
      );
    } finally {
      setAnalyzing(false);
    }
  }

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
          {analysis?.summary ? (
            <>
              <p className={styles.summary}>{analysis.summary}</p>
              {analysis.actionItems && analysis.actionItems.length > 0 && (
                <>
                  <h3 className={styles.subTitle}>Задачи</h3>
                  <ul className={styles.actionItems}>
                    {analysis.actionItems.map((it, i) => (
                      <li key={i}>{it.owner ? <strong>{it.owner}: </strong> : null}{it.text}</li>
                    ))}
                  </ul>
                </>
              )}
              <button className={styles.analyzeBtn} onClick={runAnalysis} disabled={analyzing}>
                {analyzing ? 'Анализируем…' : 'Перегенерировать'}
              </button>
            </>
          ) : (
            <>
              <p className="muted">Анализа пока нет.</p>
              <button className={styles.analyzeBtn} onClick={runAnalysis} disabled={analyzing}>
                {analyzing ? 'Анализируем…' : 'Проанализировать'}
              </button>
            </>
          )}
          {analysisError && <p className={styles.error}>{analysisError}</p>}
        </aside>
      </div>
    </div>
  );
}
