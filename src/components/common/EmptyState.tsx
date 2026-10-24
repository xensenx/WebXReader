/**
 * Empty state component for displaying when there's no content.
 */

import type { LucideIcon } from 'lucide-react';
import styles from './EmptyState.module.css';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: EmptyStateAction;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.container} role="status">
      <div className={styles.iconWrapper}>
        <Icon size={48} aria-hidden="true" />
      </div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.description}>{description}</p>
      {action && (
        <button
          className={styles.action}
          onClick={action.onClick}
          type="button"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
