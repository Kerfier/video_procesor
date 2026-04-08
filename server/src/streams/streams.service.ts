import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { AnonymizationClientService } from '../anonymization-client/anonymization-client.service.js';
import type { StartUrlDto } from './dto/start-url.dto.js';
import type { UploadFileDto } from './dto/upload-file.dto.js';
import type { StreamStatusDto } from './dto/stream-status.dto.js';
import { SESSION_REPOSITORY, type ISessionRepository } from './session.repository.interface.js';
import { UrlStreamProcessor } from './url-stream.processor.js';
import { FileStreamProcessor } from './file-stream.processor.js';

@Injectable()
export class StreamsService implements OnApplicationShutdown {
  private readonly logger = new Logger(StreamsService.name);

  constructor(
    @Inject(SESSION_REPOSITORY) private readonly repo: ISessionRepository,
    private readonly anonymizationClient: AnonymizationClientService,
    private readonly urlProcessor: UrlStreamProcessor,
    private readonly fileProcessor: FileStreamProcessor,
  ) {}

  async startUrl(body: StartUrlDto): Promise<string> {
    return this.urlProcessor.start(body);
  }

  async startFile(file: Express.Multer.File, body: UploadFileDto): Promise<string> {
    return this.fileProcessor.startProcessing(file, body);
  }

  async startFileRaw(file: Express.Multer.File): Promise<string> {
    return this.fileProcessor.startPassthrough(file);
  }

  getStatus(streamId: string): StreamStatusDto {
    const session = this.repo.getOrThrow(streamId);
    return {
      status: session.status,
      segmentCount: session.outputSegments.length,
      error: session.error,
    };
  }

  async deleteStream(streamId: string): Promise<void> {
    const session = this.repo.getOrThrow(streamId);
    session.abortController.abort();
    session.segmentQueue?.clear();
    if (session.anonymizationSessionId) {
      await this.anonymizationClient.deleteSession(session.anonymizationSessionId);
    }
    this.repo.delete(streamId);
  }

  onApplicationShutdown(): void {
    this.logger.log('Aborting active stream(s)');
    for (const session of this.repo.values()) {
      session.abortController.abort(); // kills ffmpeg for file sessions, stops poll for URL sessions
      session.segmentQueue?.clear(); // drop pending segments; in-flight segment finishes in FileStreamProcessor.onApplicationShutdown
    }
  }
}
