import { useReducer, useRef } from 'react';
import {
  deleteStream,
  startUrlStream,
  uploadFileStream,
  uploadRawFileStream,
} from '../api/streamsApi';
import type { StreamParams, StreamStatusResponse } from '../api/streamsApi';
import { useStatusPoller } from './useStatusPoller';
import { initialState, reducer } from './streamReducer';

interface UseStreamReturn {
  streamId: string | null;
  statusResponse: StreamStatusResponse | null;
  isLoading: boolean;
  startError: string | null;
  startUrl: (url: string, params: StreamParams) => Promise<void>;
  uploadFile: (file: File, params: StreamParams) => Promise<void>;
  uploadRawFile: (file: File) => Promise<void>;
  stop: () => Promise<void>;
}

export function useStream(): UseStreamReturn {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Keep latest streamId in a ref so stop() can read it synchronously
  const streamIdRef = useRef<string | null>(null);
  streamIdRef.current = state.streamId;

  const handleStatus = (response: StreamStatusResponse) => {
    dispatch({ type: 'STATUS', response });
  };

  const { stopPolling } = useStatusPoller(state.streamId, handleStatus);

  // Generic helper — each public method calls this with the appropriate API fn
  const runStart = async (apiFn: () => Promise<string>, fallbackMsg: string) => {
    dispatch({ type: 'START' });
    try {
      const streamId = await apiFn();
      dispatch({ type: 'START_OK', streamId });
    } catch (err) {
      const message = err instanceof Error ? err.message : fallbackMsg;
      dispatch({ type: 'START_ERR', message });
    }
  };

  const startUrl = (url: string, params: StreamParams) =>
    runStart(() => startUrlStream(url, params), 'Failed to start stream');

  const uploadFile = (file: File, params: StreamParams) =>
    runStart(() => uploadFileStream(file, params), 'Failed to upload file');

  const uploadRawFile = (file: File) =>
    runStart(() => uploadRawFileStream(file), 'Failed to upload file');

  const stop = async () => {
    stopPolling();
    const id = streamIdRef.current;
    if (id) {
      await deleteStream(id).catch(() => {});
    }
    dispatch({ type: 'RESET' });
  };

  return {
    streamId: state.streamId,
    statusResponse: state.statusResponse,
    isLoading: state.isLoading,
    startError: state.startError,
    startUrl,
    uploadFile,
    uploadRawFile,
    stop,
  };
}
