import type { InputHTMLAttributes } from 'react';
import styles from './TextField.module.scss';
interface Props extends InputHTMLAttributes<HTMLInputElement> { label?: string; error?: string; }
export function TextField({ label, error, className, id, ...rest }: Props) {
  return (
    <div className={styles.field}>
      {label && <label htmlFor={id} className={styles.label}>{label}</label>}
      <input id={id} className={`${styles.input} ${error ? styles.invalid : ''} ${className ?? ''}`} {...rest} />
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}
