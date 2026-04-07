import { Module } from '@nestjs/common';
import { AnonymizationClientService } from './python-client.service.js';

@Module({
  providers: [AnonymizationClientService],
  exports: [AnonymizationClientService],
})
export class PythonClientModule {}
