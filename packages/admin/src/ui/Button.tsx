import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.scss';
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'ghost'; }
export function Button({ variant = 'primary', className, ...rest }: Props) {
  return <button className={`${styles.btn} ${styles[variant]} ${className ?? ''}`} {...rest} />;
}
