import axios from 'axios';
import { START_TIMEOUT_MS } from '../constants/streams';
import { buildStreamFormData } from '../utils/file';

export type StreamStatus = 'processing' | 'done' | 'error';

export interface StreamParams {
  detectionInterval?: number;
  blurStrength?: number;
  conf?: number;
  lookbackFrames?: number;
}

export interface StreamStatusResponse {
  status: StreamStatus;
  segmentCount: number;
  error?: string;
}

type StartStreamResponse = { streamId: string };

const api = axios.create({ timeout: START_TIMEOUT_MS });

export async function startUrlStream(url: string, params: StreamParams = {}): Promise<string> {
  const { data } = await api.post<StartStreamResponse>('/api/streams/start-url', {
    url,
    ...params,
  });
  return data.streamId;
}

function makeProgressHandler(
  onUploadProgress?: (percent: number) => void,
): ((e: { loaded: number; total?: number }) => void) | undefined {
  if (!onUploadProgress) {
    return undefined;
  }
  return (e) => {
    if (e.total) {
      onUploadProgress(Math.round((e.loaded / e.total) * 100));
    }
  };
}

export async function uploadFileStream(
  file: File,
  params: StreamParams = {},
  onUploadProgress?: (percent: number) => void,
): Promise<string> {
  const { data } = await api.post<StartStreamResponse>(
    '/api/streams/upload',
    buildStreamFormData(file, params),
    { timeout: 0, onUploadProgress: makeProgressHandler(onUploadProgress) },
  );
  return data.streamId;
}

export async function uploadRawFileStream(
  file: File,
  onUploadProgress?: (percent: number) => void,
): Promise<string> {
  const { data } = await api.post<StartStreamResponse>(
    '/api/streams/upload-raw',
    buildStreamFormData(file),
    { timeout: 0, onUploadProgress: makeProgressHandler(onUploadProgress) },
  );
  return data.streamId;
}

export async function getStreamStatus(streamId: string): Promise<StreamStatusResponse> {
  const { data } = await api.get<StreamStatusResponse>(`/api/streams/${streamId}/status`);
  return data;
}

export async function deleteStream(streamId: string): Promise<void> {
  try {
    await api.delete(`/api/streams/${streamId}`);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return;
    }
    throw err;
  }
}
