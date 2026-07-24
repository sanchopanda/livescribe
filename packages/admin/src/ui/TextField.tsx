import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import styles from './TextField.module.scss';
interface Props extends InputHTMLAttributes<HTMLInputElement> { label?: string; error?: string; }
export function TextField({ label, error, className, id, ...rest }: Props) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className={styles.field}>
      {label && <label htmlFor={inputId} className={styles.label}>{label}</label>}
      <input id={inputId} className={`${styles.input} ${error ? styles.invalid : ''} ${className ?? ''}`} {...rest} />
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}
