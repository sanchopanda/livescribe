import styles from './MeetingsPage.module.scss';

export function MeetingsPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Переговоры</h1>
      <div className={styles.empty}>Пока нет переговоров. Начните запись в расширении.</div>
    </div>
  );
}
