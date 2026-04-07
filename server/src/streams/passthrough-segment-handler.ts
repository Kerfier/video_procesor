import type { SegmentInfo } from '../types.js';
import type { ISegmentHandler } from './segment-handler.interface.js';

export class PassthroughSegmentHandler implements ISegmentHandler {
  process(seg: SegmentInfo): Promise<Buffer> {
    return Promise.resolve(seg.buffer);
  }
}
