import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteStream,
  getStreamStatus,
  startUrlStream,
  uploadFileStream,
} from '../api/streamsApi';
import type { StreamParams, StreamStatusResponse } from '../api/streamsApi';

interface UseStreamReturn {
  streamId: string | null;
  statusResponse: StreamStatusResponse | null;
  isLoading: boolean;
  startError: string | null;
  startUrl: (url: string, params: StreamParams) => Promise<void>;
  uploadFile: (file: File, params: StreamParams) => Promise<void>;
  stop: () => Promise<void>;
}

export function useStream(): UseStreamReturn {
  const [streamId, setStreamId] = useState<string | null>(null);
  const [statusResponse, setStatusResponse] = useState<StreamStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRef = useRef<string | null>(null);
  const streamIdRef = useRef<string | null>(null);

  // Keep ref in sync with state (for use inside intervals without stale closures)
  useEffect(() => {
    streamIdRef.current = streamId;
  }, [streamId]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!streamId) return;

    intervalRef.current = setInterval(() => {
      const id = streamIdRef.current;
      if (!id) return;

      getStreamStatus(id)
        .then((data) => {
          setStatusResponse(data);
          statusRef.current = data.status;
          if (data.status === 'done' || data.status === 'error') {
            stopPolling();
          }
        })
        .catch(() => {
          // Swallow polling errors — transient network issues shouldn't crash the UI
        });
    }, 2000);

    return stopPolling;
  }, [streamId, stopPolling]);

  const startUrl = useCallback(
    async (url: string, params: StreamParams) => {
      setIsLoading(true);
      setStartError(null);
      try {
        const id = await startUrlStream(url, params);
        setStreamId(id);
        setStatusResponse(null);
        statusRef.current = null;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to start stream';
        setStartError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const uploadFile = useCallback(
    async (file: File, params: StreamParams) => {
      setIsLoading(true);
      setStartError(null);
      try {
        const id = await uploadFileStream(file, params);
        setStreamId(id);
        setStatusResponse(null);
        statusRef.current = null;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to upload file';
        setStartError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const stop = useCallback(async () => {
    stopPolling();
    const id = streamIdRef.current;
    if (id) {
      await deleteStream(id).catch(() => {});
    }
    setStreamId(null);
    setStatusResponse(null);
    setStartError(null);
    statusRef.current = null;
  }, [stopPolling]);

  return { streamId, statusResponse, isLoading, startError, startUrl, uploadFile, stop };
}
