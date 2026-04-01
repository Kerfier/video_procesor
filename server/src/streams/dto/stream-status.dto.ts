import type { StreamStatus } from '../../types.js';

export class StreamStatusDto {
  status: StreamStatus;
  segmentCount: number;
  error?: string;
}
