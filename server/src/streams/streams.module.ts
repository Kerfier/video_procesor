import { Module } from '@nestjs/common';
import { PythonClientModule } from '../python-client/python-client.module.js';
import { HlsModule } from '../hls/hls.module.js';
import { StreamsService } from './streams.service.js';
import { StreamsController } from './streams.controller.js';
import { HlsEgressService } from './hls-egress.service.js';
import { HlsEgressController } from './hls-egress.controller.js';

@Module({
  imports: [PythonClientModule, HlsModule],
  controllers: [StreamsController, HlsEgressController],
  providers: [StreamsService, HlsEgressService],
  exports: [StreamsService],
})
export class StreamsModule {}
