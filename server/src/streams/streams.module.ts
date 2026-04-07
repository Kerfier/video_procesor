import { Module } from '@nestjs/common';
import { PythonClientModule } from '../python-client/python-client.module.js';
import { HlsModule } from '../hls/hls.module.js';
import { StreamsService } from './streams.service.js';
import { StreamsController } from './streams.controller.js';
import { HlsEgressService } from './hls-egress.service.js';
import { HlsEgressController } from './hls-egress.controller.js';
import { InMemorySessionRepository } from './in-memory-session.repository.js';
import { SESSION_REPOSITORY } from './session.repository.interface.js';
import { UrlStreamProcessor } from './url-stream.processor.js';
import { FileStreamProcessor } from './file-stream.processor.js';

@Module({
  imports: [PythonClientModule, HlsModule],
  controllers: [StreamsController, HlsEgressController],
  providers: [
    {
      provide: SESSION_REPOSITORY,
      useClass: InMemorySessionRepository,
    },
    UrlStreamProcessor,
    FileStreamProcessor,
    StreamsService,
    HlsEgressService,
  ],
  exports: [StreamsService],
})
export class StreamsModule {}
