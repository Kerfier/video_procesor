import { Logger } from '@nestjs/common';
import { isAxiosError } from 'axios';
import { AnonymizationClientService } from '../anonymization-client/anonymization-client.service.js';
import type { SegmentInfo } from '../types.js';
import type { ISegmentHandler } from './segment-handler.interface.js';

export class AnonymizationSegmentHandler implements ISegmentHandler {
  constructor(
    private readonly anonymizationClient: AnonymizationClientService,
    private readonly anonymizationSessionId: string,
    private readonly logger: Logger,
  ) {}

  async process(seg: SegmentInfo): Promise<Buffer> {
    try {
      return await this.anonymizationClient.processSegment(this.anonymizationSessionId, seg.buffer);
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 422) {
        this.logger.warn(`Corrupt segment ${seg.sequence} (422) — passing through original bytes`);
        return seg.buffer;
      }
      throw err;
    }
  }
}
