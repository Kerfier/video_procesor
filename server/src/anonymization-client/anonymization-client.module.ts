import { Module } from '@nestjs/common';
import { AnonymizationClientService } from './anonymization-client.service.js';

@Module({
  providers: [AnonymizationClientService],
  exports: [AnonymizationClientService],
})
export class AnonymizationClientModule {}
