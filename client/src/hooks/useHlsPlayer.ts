import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import { hlsConfig } from '../config/hlsConfig';
import type { StreamStatus } from '../api/streamsApi';

export function useHlsPlayer(streamId: string, status: StreamStatus) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [hlsError, setHlsError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const playlistUrl = `/streams/${streamId}/playlist.m3u8`;
    setHlsError(null);

    if (Hls.isSupported()) {
      const hls = new Hls(hlsConfig);
      hlsRef.current = hls;

      const onError = (_event: unknown, data: { fatal: boolean; details: string }) => {
        if (data.fatal) {
          setHlsError(`Playback error: ${data.details}`);
        }
      };
      hls.on(Hls.Events.ERROR, onError);

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
        hlsRef.current.off(Hls.Events.ERROR); // detach before destroy to prevent spurious error state
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (video.src) {
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [streamId]);

  useEffect(() => {
    if (status === 'error' && hlsRef.current) {
      hlsRef.current.stopLoad();
    }
  }, [status]);

  return { videoRef, hlsError };
}
