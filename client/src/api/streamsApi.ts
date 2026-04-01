import axios from 'axios';

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

const api = axios.create({ timeout: 30_000 });

export async function startUrlStream(url: string, params: StreamParams = {}): Promise<string> {
  const { data } = await api.post<StartStreamResponse>('/api/streams/start-url', {
    url,
    ...params,
  });
  return data.streamId;
}

export async function uploadFileStream(
  file: File,
  params: StreamParams = {},
  onUploadProgress?: (percent: number) => void,
): Promise<string> {
  const form = new FormData();
  form.append('video', file, file.name);
  if (params.detectionInterval !== undefined) form.append('detectionInterval', String(params.detectionInterval));
  if (params.blurStrength !== undefined) form.append('blurStrength', String(params.blurStrength));
  if (params.conf !== undefined) form.append('conf', String(params.conf));
  if (params.lookbackFrames !== undefined) form.append('lookbackFrames', String(params.lookbackFrames));

  const { data } = await api.post<StartStreamResponse>('/api/streams/upload', form, {
    timeout: 0,
    onUploadProgress: onUploadProgress
      ? (e) => {
          if (e.total) onUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      : undefined,
  });
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
    if (axios.isAxiosError(err) && err.response?.status === 404) return;
    throw err;
  }
}
