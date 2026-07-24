import { useAuth } from '../auth/AuthContext';
import styles from './SettingsPage.module.scss';

export function SettingsPage() {
  const { me } = useAuth();

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
          Установите расширение Skribo в Chrome и войдите в нём (кнопка в панели браузера →
          вход по email и паролю). Если вы уже вошли в этот кабинет, расширение подхватит
          сессию автоматически. После входа переговоры со звонков будут сохраняться сюда.
        </p>
      </section>
    </div>
  );
}
