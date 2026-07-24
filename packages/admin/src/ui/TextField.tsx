import { useId, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import styles from './TextField.module.scss';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

export function TextField({ label, error, className, id, type, ...rest }: Props) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  const effectiveType = isPassword && visible ? 'text' : type;

  return (
    <div className={styles.field}>
      {label && <label htmlFor={inputId} className={styles.label}>{label}</label>}
      <div className={styles.inputWrap}>
        <input
          id={inputId}
          type={effectiveType}
          className={`${styles.input} ${isPassword ? styles.withToggle : ''} ${error ? styles.invalid : ''} ${className ?? ''}`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            className={styles.toggle}
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
            title={visible ? 'Скрыть пароль' : 'Показать пароль'}
          >
            <EyeIcon off={visible} />
          </button>
        )}
      </div>
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}
