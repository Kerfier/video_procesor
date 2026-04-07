import { useEffect, useRef } from 'react';
import { getStreamStatus } from '../api/streamsApi';
import type { StreamStatusResponse } from '../api/streamsApi';
import { POLL_INTERVAL_MS } from '../constants/streams';

/**
 * Polls for stream status every POLL_INTERVAL_MS.
 * Stops automatically when status is 'done' or 'error'.
 * Returns stopPolling so callers can stop early (e.g. on manual stop).
 */
export function useStatusPoller(
  streamId: string | null,
  onStatus: (resp: StreamStatusResponse) => void,
): { stopPolling: () => void } {
  // Hold the latest callback in a ref so the interval closure never goes stale
  const callbackRef = useRef(onStatus);
  useEffect(() => {
    callbackRef.current = onStatus;
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  useEffect(() => {
    if (!streamId) {
      return;
    }

    intervalRef.current = setInterval(() => {
      getStreamStatus(streamId)
        .then((data) => {
          callbackRef.current(data);
          if (data.status === 'done' || data.status === 'error') {
            stopPolling();
          }
        })
        .catch(() => {
          // Swallow polling errors — transient network issues shouldn't crash the UI
        });
    }, POLL_INTERVAL_MS);

    return stopPolling;
    // stopPolling reads intervalRef directly — no stability needed in deps
  }, [streamId]);

  return { stopPolling };
}
