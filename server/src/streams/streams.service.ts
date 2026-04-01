import { Injectable, Logger, NotFoundException, OnApplicationShutdown } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import { PythonClientService } from '../python-client/python-client.service.js';
import { HlsIngressService } from '../hls/hls-ingress.service.js';
import type { OutputSegment, SegmentInfo, SessionParams, StreamStatus } from '../types.js';
import type { StartUrlDto } from './dto/start-url.dto.js';
import type { StreamStatusDto } from './dto/stream-status.dto.js';

// p-queue is ESM-only; load via dynamic import from this CJS context.
// Minimal interface covering the methods we use.
interface IQueue {
  add(fn: () => Promise<void>): Promise<void>;
  clear(): void;
  onIdle(): Promise<void>;
}

const DEFAULT_PARAMS = {
  detectionInterval: 5,
  blurStrength: 51,
  conf: 0.25,
  lookbackFrames: 30,
} as const;

interface StreamSession {
  streamId: string;
  pythonSessionId: string;
  status: StreamStatus;
  inputType: 'url' | 'file';
  outputDir: string;
  outputSegments: OutputSegment[];
  segmentQueue: IQueue;
  abortController: AbortController;
  error?: string;
}

@Injectable()
export class StreamsService implements OnApplicationShutdown {
  private readonly logger = new Logger(StreamsService.name);
  private readonly sessions = new Map<string, StreamSession>();
  private readonly outputBaseDir: string;
  private PQueueClass: (new (opts: { concurrency: number }) => IQueue) | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly pythonClient: PythonClientService,
    private readonly hlsIngress: HlsIngressService,
  ) {
    this.outputBaseDir = this.config.get<string>('OUTPUT_DIR') ?? path.join(os.tmpdir(), 'streams');
  }

  private async getPQueueClass(): Promise<new (opts: { concurrency: number }) => IQueue> {
    if (!this.PQueueClass) {
      // p-queue is ESM-only; dynamic import works from CJS at runtime
      const mod = (await import('p-queue')) as {
        default: new (opts: { concurrency: number }) => IQueue;
      };
      this.PQueueClass = mod.default;
    }
    return this.PQueueClass;
  }

  async startUrl(body: StartUrlDto): Promise<string> {
    const streamId = uuidv4();
    this.logger.log(`Starting URL stream ${streamId} for ${body.url}`);

    const probeResult = await this.hlsIngress.probeUrl(body.url);
    const pythonSessionId = await this.pythonClient.createSession(
      this.buildSessionParams(body, probeResult),
    );

    const outputDir = path.join(this.outputBaseDir, streamId);
    await fs.promises.mkdir(outputDir, { recursive: true });

    const PQueue = await this.getPQueueClass();
    const abortController = new AbortController();
    const session: StreamSession = {
      streamId,
      pythonSessionId,
      status: 'processing',
      inputType: 'url',
      outputDir,
      outputSegments: [],
      segmentQueue: new PQueue({ concurrency: 1 }),
      abortController,
    };
    this.sessions.set(streamId, session);

    void this.runUrlStream(streamId, body.url, abortController.signal);
    return streamId;
  }

  async startFile(file: Express.Multer.File, body: Partial<StartUrlDto>): Promise<string> {
    const streamId = uuidv4();
    this.logger.log(`Starting file stream ${streamId} for ${file.originalname}`);

    const probeResult = await this.hlsIngress.probeFile(file.path);
    const pythonSessionId = await this.pythonClient.createSession(
      this.buildSessionParams(body, probeResult),
    );

    const outputDir = path.join(this.outputBaseDir, streamId);
    await fs.promises.mkdir(outputDir, { recursive: true });

    const PQueue = await this.getPQueueClass();
    const abortController = new AbortController();
    const session: StreamSession = {
      streamId,
      pythonSessionId,
      status: 'processing',
      inputType: 'file',
      outputDir,
      outputSegments: [],
      segmentQueue: new PQueue({ concurrency: 1 }),
      abortController,
    };
    this.sessions.set(streamId, session);

    void this.runFileStream(streamId, file.path);
    return streamId;
  }

  getStatus(streamId: string): StreamStatusDto {
    const session = this.getSessionOrThrow(streamId);
    return {
      status: session.status,
      segmentCount: session.outputSegments.length,
      error: session.error,
    };
  }

  getSession(streamId: string): StreamSession {
    return this.getSessionOrThrow(streamId);
  }

  async deleteStream(streamId: string): Promise<void> {
    const session = this.getSessionOrThrow(streamId);
    session.abortController.abort();
    session.segmentQueue.clear();
    await this.pythonClient.deleteSession(session.pythonSessionId);
    this.sessions.delete(streamId);
  }

  async onApplicationShutdown(): Promise<void> {
    this.logger.log(`Shutting down ${this.sessions.size} active stream(s)`);
    for (const session of this.sessions.values()) {
      session.abortController.abort();
      session.segmentQueue.clear();
    }
    const drainPromises = [...this.sessions.values()].map((s) =>
      Promise.race([s.segmentQueue.onIdle(), new Promise<void>((r) => setTimeout(r, 10_000))]),
    );
    await Promise.all(drainPromises);
  }

  private async runUrlStream(streamId: string, url: string, signal: AbortSignal): Promise<void> {
    const session = this.sessions.get(streamId);
    if (!session) return;
    try {
      await this.hlsIngress.streamUrl(url, (seg) => this.enqueueSegment(streamId, seg), signal);
      await session.segmentQueue.onIdle();
      if (session.status !== 'error') session.status = 'done';
    } catch (err) {
      this.setError(session, err);
    }
  }

  private async runFileStream(streamId: string, filePath: string): Promise<void> {
    const session = this.sessions.get(streamId);
    if (!session) return;
    try {
      await this.hlsIngress.segmentAndStream(filePath, (seg) => this.enqueueSegment(streamId, seg));
      await session.segmentQueue.onIdle();
      if (session.status !== 'error') session.status = 'done';
    } catch (err) {
      this.setError(session, err);
    } finally {
      await fs.promises.unlink(filePath).catch(() => undefined);
    }
  }

  private enqueueSegment(streamId: string, seg: SegmentInfo): void {
    const session = this.sessions.get(streamId);
    if (!session || session.status === 'error') return;

    void session.segmentQueue.add(async () => {
      try {
        const processed = await this.pythonClient.processSegment(
          session.pythonSessionId,
          seg.buffer,
        );
        const filename = `seg_${String(seg.sequence).padStart(4, '0')}.ts`;
        await fs.promises.writeFile(path.join(session.outputDir, filename), processed);
        session.outputSegments.push({
          filename,
          duration: seg.duration,
          sequence: seg.sequence,
        });
      } catch (err: unknown) {
        const status =
          err instanceof Error && 'response' in err
            ? (err as { response?: { status?: number } }).response?.status
            : undefined;
        if (status === 422) {
          this.logger.warn(
            `Corrupt segment ${seg.sequence} for stream ${streamId} — passing through original`,
          );
          const filename = `seg_${String(seg.sequence).padStart(4, '0')}.ts`;
          await fs.promises.writeFile(path.join(session.outputDir, filename), seg.buffer);
          session.outputSegments.push({ filename, duration: seg.duration, sequence: seg.sequence });
          return;
        }
        this.setError(session, err);
        session.segmentQueue.clear();
      }
    });
  }

  private setError(session: StreamSession, err: unknown): void {
    session.status = 'error';
    session.error = err instanceof Error ? err.message : String(err);
    this.logger.error(`Stream ${session.streamId} error: ${session.error}`);
    void this.pythonClient.deleteSession(session.pythonSessionId);
  }

  private getSessionOrThrow(streamId: string): StreamSession {
    const session = this.sessions.get(streamId);
    if (!session) throw new NotFoundException(`Stream ${streamId} not found`);
    return session;
  }

  private buildSessionParams(
    dto: Partial<StartUrlDto>,
    probe: { width: number; height: number; fps: number },
  ): SessionParams {
    return {
      detectionInterval: dto.detectionInterval ?? DEFAULT_PARAMS.detectionInterval,
      blurStrength: dto.blurStrength ?? DEFAULT_PARAMS.blurStrength,
      conf: dto.conf ?? DEFAULT_PARAMS.conf,
      lookbackFrames: dto.lookbackFrames ?? DEFAULT_PARAMS.lookbackFrames,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
    };
  }
}
