import { useHlsPlayer } from '../../hooks/useHlsPlayer';
import styles from './StreamPlayer.module.css';

interface StreamPlayerProps {
  streamId: string;
  onStop: () => void;
}

export function StreamPlayer({ streamId, onStop }: StreamPlayerProps) {
  const { videoRef, hlsError } = useHlsPlayer(streamId);

  return (
    <div className={`${styles.container} ${styles.visible}`}>
      {hlsError && <div className={styles.errorBanner}>{hlsError}</div>}

      <div className={styles.videoWrapper}>
        <video ref={videoRef} className={styles.video} controls autoPlay muted playsInline />
      </div>

      <div className={styles.footer}>
        <span className={styles.streamId}>stream/{streamId}</span>
        <button className={styles.stopBtn} type="button" onClick={onStop}>
          Stop & Delete
        </button>
      </div>
    </div>
  );
}
