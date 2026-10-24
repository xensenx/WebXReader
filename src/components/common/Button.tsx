/**
 * Reusable Button component with variants, sizes, and loading state.
 */

import React from 'react';
import { Loader2 } from 'lucide-react';
import styles from './Button.module.css';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  const classNames = [
    styles.button,
    styles[variant],
    styles[size],
    loading ? styles.loading : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={classNames}
      disabled={disabled || loading}
      aria-busy={loading}
      {...rest}
    >
      {loading ? (
        <Loader2 className={styles.spinner} aria-hidden="true" />
      ) : icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children && <span className={styles.label}>{children}</span>}
    </button>
  );
}
