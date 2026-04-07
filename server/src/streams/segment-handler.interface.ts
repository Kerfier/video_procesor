import type { SegmentInfo } from '../types.js';

export interface ISegmentHandler {
  process(seg: SegmentInfo): Promise<Buffer>;
}
