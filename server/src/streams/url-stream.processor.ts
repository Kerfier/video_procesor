import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { AnonymizationClientService } from '../python-client/python-client.service.js';
import { StreamStatus, type UrlSessionParams } from '../types.js';
import type { StartUrlDto } from './dto/start-url.dto.js';
import { SESSION_REPOSITORY, type ISessionRepository } from './session.repository.interface.js';
import { sleep } from '../common/sleep.js';
import { DEFAULT_PROCESSING_PARAMS } from './defaults.js';

@Injectable()
export class UrlStreamProcessor {
  private readonly logger = new Logger(UrlStreamProcessor.name);
  private readonly outputBaseDir: string;
  private readonly pollMs: number;

  constructor(
    @Inject(SESSION_REPOSITORY) private readonly repo: ISessionRepository,
    private readonly anonymizationClient: AnonymizationClientService,
    private readonly config: ConfigService,
  ) {
    this.outputBaseDir = this.config.get<string>('OUTPUT_DIR') ?? path.join(os.tmpdir(), 'streams');
    this.pollMs = this.config.get<number>('STREAM_POLL_MS') ?? 500;
  }

  async start(body: StartUrlDto): Promise<string> {
    const streamId = uuidv4();
    this.logger.log(`Starting URL stream ${streamId} for ${body.url}`);

    const outputDir = path.join(this.outputBaseDir, streamId);
    await fs.promises.mkdir(outputDir, { recursive: true });

    const urlParams: UrlSessionParams = {
      mode: 'pull',
      url: body.url,
      outputDir,
      detectionInterval: body.detectionInterval ?? DEFAULT_PROCESSING_PARAMS.detectionInterval,
      blurStrength: body.blurStrength ?? DEFAULT_PROCESSING_PARAMS.blurStrength,
      conf: body.conf ?? DEFAULT_PROCESSING_PARAMS.conf,
      lookbackFrames: body.lookbackFrames ?? DEFAULT_PROCESSING_PARAMS.lookbackFrames,
    };
    const pythonSessionId = await this.anonymizationClient.createSession(urlParams);

    const abortController = new AbortController();
    this.repo.create({
      streamId,
      pythonSessionId,
      status: StreamStatus.Processing,
      inputType: 'url',
      outputDir,
      outputSegments: [],
      segmentQueue: null,
      abortController,
    });

    this.poll(streamId, pythonSessionId, abortController.signal).catch((err: unknown) => {
      this.logger.error(`Unhandled error in URL poll for stream ${streamId}: ${String(err)}`);
      this.repo.setStatus(
        streamId,
        StreamStatus.Error,
        err instanceof Error ? err.message : String(err),
      );
    });

    return streamId;
  }

  private async poll(
    streamId: string,
    pythonSessionId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const session = this.repo.get(streamId);
    if (!session) {
      return;
    }

    try {
      while (!signal.aborted) {
        const pyStatus = await this.anonymizationClient.getSessionStatus(pythonSessionId);

        const known = session.outputSegments.length;
        for (let seq = known; seq < pyStatus.segmentCount; seq++) {
          const filename = `seg_${String(seq).padStart(4, '0')}.ts`;
          this.repo.addSegment(streamId, { filename, duration: 2, sequence: seq });
        }

        if (pyStatus.status === StreamStatus.Done) {
          this.repo.setStatus(streamId, StreamStatus.Done);
          return;
        }
        if (pyStatus.status === StreamStatus.Error) {
          this.repo.setStatus(
            streamId,
            StreamStatus.Error,
            pyStatus.error ?? 'Python pull session failed',
          );
          this.logger.error(`Stream ${streamId} error from Python: ${pyStatus.error ?? ''}`);
          return;
        }

        await sleep(this.pollMs, signal);
      }
    } catch (err) {
      if (!signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Stream ${streamId} poll error: ${message}`);
        this.repo.setStatus(streamId, StreamStatus.Error, message);
      }
    }
  }
}
