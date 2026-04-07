import { Exclude, Expose } from 'class-transformer';
import type { StreamStatus } from '../../types.js';

@Exclude()
export class StreamStatusDto {
  @Expose()
  status: StreamStatus;

  @Expose()
  segmentCount: number;

  @Expose()
  error?: string;
}
