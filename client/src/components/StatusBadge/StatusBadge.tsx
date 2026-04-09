import type { StreamStatus } from '../../api/streamsApi';
import styles from './StatusBadge.module.css';

interface StatusBadgeProps {
  status: StreamStatus;
  segmentCount: number;
  error?: string;
}

const STATUS_LABEL: Record<StreamStatus, string> = {
  processing: 'Processing',
  done: 'Complete',
  error: 'Error',
};

export function StatusBadge({ status, segmentCount, error }: StatusBadgeProps) {
  return (
    <div className={styles.wrapper} data-status={status}>
      <div className={styles.row}>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.label}>{STATUS_LABEL[status]}</span>
        <span className={styles.segments}>
          {segmentCount} {segmentCount === 1 ? 'segment' : 'segments'}
        </span>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
