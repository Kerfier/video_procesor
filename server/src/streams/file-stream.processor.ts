import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AnonymizationClientService } from '../anonymization-client/anonymization-client.service.js';
import { HlsIngressService } from '../hls/hls-ingress.service.js';
import { StreamStatus, type SegmentInfo, type SessionParams } from '../types.js';
import type { UploadFileDto } from './dto/upload-file.dto.js';
import {
  SESSION_REPOSITORY,
  type ISessionRepository,
  type IQueue,
} from './session.repository.interface.js';
import { DEFAULT_PROCESSING_PARAMS } from './defaults.js';
import { AnonymizationSegmentHandler } from './anonymization-segment-handler.js';
import { PassthroughSegmentHandler } from './passthrough-segment-handler.js';
import type { ISegmentHandler } from './segment-handler.interface.js';

@Injectable()
export class FileStreamProcessor implements OnApplicationShutdown {
  private readonly logger = new Logger(FileStreamProcessor.name);
  private readonly outputBaseDir: string;
  private PQueueClass: (new (opts: { concurrency: number }) => IQueue) | null = null;

  constructor(
    @Inject(SESSION_REPOSITORY) private readonly repo: ISessionRepository,
    private readonly anonymizationClient: AnonymizationClientService,
    private readonly hlsIngress: HlsIngressService,
    private readonly config: ConfigService,
  ) {
    this.outputBaseDir = this.config.get<string>('OUTPUT_DIR') ?? path.join(os.tmpdir(), 'streams');
  }

  async onApplicationShutdown(): Promise<void> {
    const queues = [...this.repo.values()]
      .map((s) => s.segmentQueue)
      .filter((q): q is IQueue => q !== null);
    this.logger.log(`Draining ${queues.length} segment queue(s) before shutdown`);
    await Promise.all(
      queues.map((q) =>
        Promise.race([q.onIdle(), new Promise<void>((r) => setTimeout(r, 10_000))]),
      ),
    );
  }

  async startAnonymization(file: Express.Multer.File, body: UploadFileDto): Promise<string> {
    const probeResult = await this.hlsIngress.probeFile(file.path);
    const anonymizationSessionId = await this.anonymizationClient.createPushSession(
      this.buildSessionParams(body, probeResult),
    );
    const handler = new AnonymizationSegmentHandler(
      this.anonymizationClient,
      anonymizationSessionId,
      this.logger,
    );
    return this.startSession(file, handler, anonymizationSessionId);
  }

  async startPassthrough(file: Express.Multer.File): Promise<string> {
    return this.startSession(file, new PassthroughSegmentHandler());
  }

  private async startSession(
    file: Express.Multer.File,
    handler: ISegmentHandler,
    anonymizationSessionId?: string,
  ): Promise<string> {
    const { streamId, outputDir, queue, abortController } = await this.initFileSession(
      file.originalname,
    );
    this.repo.create({
      streamId,
      anonymizationSessionId,
      status: StreamStatus.Processing,
      inputType: 'file',
      outputDir,
      outputSegments: [],
      segmentQueue: queue,
      abortController,
    });

    this.run(streamId, file.path, queue, handler).catch((err: unknown) => {
      this.logger.error(`Unhandled error in file stream ${streamId}: ${String(err)}`);
      this.repo.setStatus(
        streamId,
        StreamStatus.Error,
        err instanceof Error ? err.message : String(err),
      );
    });

    return streamId;
  }

  private async run(
    streamId: string,
    filePath: string,
    queue: IQueue,
    handler: ISegmentHandler,
  ): Promise<void> {
    const session = this.repo.get(streamId);
    if (!session) {
      return;
    }
    try {
      await this.hlsIngress.segmentAndStream(
        filePath,
        (seg) => this.enqueue(streamId, seg, queue, handler),
        session.abortController.signal,
      );
      await queue.onIdle();
      const current = this.repo.get(streamId);
      if (current && current.status !== StreamStatus.Error) {
        this.repo.setStatus(streamId, StreamStatus.Done);
      }
    } catch (err) {
      if (!session.abortController.signal.aborted) {
        this.handleError(streamId, err, session.anonymizationSessionId);
      }
    } finally {
      await fs.promises.unlink(filePath).catch(() => undefined);
    }
  }

  private enqueue(
    streamId: string,
    seg: SegmentInfo,
    queue: IQueue,
    handler: ISegmentHandler,
  ): void {
    const session = this.repo.get(streamId);
    if (!session || session.status === StreamStatus.Error) {
      return;
    }

    void queue.add(async () => {
      try {
        this.logger.log(`Stream ${streamId}: processing segment ${seg.sequence}`);
        const data = await handler.process(seg);
        const filename = `seg_${String(seg.sequence).padStart(4, '0')}.ts`;
        await fs.promises.writeFile(path.join(session.outputDir, filename), data);
        this.repo.addSegment(streamId, {
          filename,
          duration: seg.duration,
          sequence: seg.sequence,
        });
        this.logger.log(`Stream ${streamId}: segment ${seg.sequence} done`);
      } catch (err: unknown) {
        this.handleError(streamId, err, session.anonymizationSessionId);
        queue.clear();
      }
    });
  }

  private handleError(streamId: string, err: unknown, anonymizationSessionId?: string): void {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`Stream ${streamId} error: ${message}`);
    this.repo.setStatus(streamId, StreamStatus.Error, message);
    if (anonymizationSessionId) {
      void this.anonymizationClient.deleteSession(anonymizationSessionId);
    }
  }

  private async initFileSession(label: string): Promise<{
    streamId: string;
    outputDir: string;
    queue: IQueue;
    abortController: AbortController;
  }> {
    const streamId = uuidv4();
    this.logger.log(`Starting file stream ${streamId} for ${label}`);
    const outputDir = path.join(this.outputBaseDir, streamId);
    await fs.promises.mkdir(outputDir, { recursive: true });
    const queue = await this.createQueue();
    return { streamId, outputDir, queue, abortController: new AbortController() };
  }

  private async createQueue(): Promise<IQueue> {
    if (!this.PQueueClass) {
      const mod = (await import('p-queue')) as {
        default: new (opts: { concurrency: number }) => IQueue;
      };
      this.PQueueClass = mod.default;
    }
    return new this.PQueueClass({ concurrency: 1 });
  }

  private buildSessionParams(
    dto: UploadFileDto,
    probe: { width: number; height: number; fps: number },
  ): SessionParams {
    return {
      mode: 'push',
      detectionInterval: dto.detectionInterval ?? DEFAULT_PROCESSING_PARAMS.detectionInterval,
      blurStrength: dto.blurStrength ?? DEFAULT_PROCESSING_PARAMS.blurStrength,
      conf: dto.conf ?? DEFAULT_PROCESSING_PARAMS.conf,
      lookbackFrames: dto.lookbackFrames ?? DEFAULT_PROCESSING_PARAMS.lookbackFrames,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
    };
  }
}
