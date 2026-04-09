import type { HlsConfig } from 'hls.js';

export const hlsConfig: Partial<HlsConfig> = {
  enableWorker: true,
  lowLatencyMode: true,
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  liveSyncDurationCount: 2,
  maxBufferHole: 0.5,
  nudgeOffset: 0.1,
  startLevel: -1,
};
