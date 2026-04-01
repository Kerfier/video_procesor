import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import styles from './StreamPlayer.module.css';

interface StreamPlayerProps {
  streamId: string;
  onStop: () => void;
  isVisible: boolean;
}

export function StreamPlayer({ streamId, onStop, isVisible }: StreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [hlsError, setHlsError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const playlistUrl = `/streams/${streamId}/playlist.m3u8`;
    setHlsError(null);

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 500,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 500,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setHlsError(`Playback error: ${data.details}`);
        }
      });

      hls.loadSource(playlistUrl);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = playlistUrl;
    } else {
      setHlsError('HLS playback is not supported in this browser.');
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (video.src) {
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [streamId]);

  return (
    <div className={`${styles.container} ${isVisible ? styles.visible : ''}`}>
      {hlsError && <div className={styles.errorBanner}>{hlsError}</div>}

      <div className={styles.videoWrapper}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          className={styles.video}
          controls
          playsInline
        />
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
