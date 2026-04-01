import { Module } from '@nestjs/common';
import { PythonClientService } from './python-client.service.js';

@Module({
  providers: [PythonClientService],
  exports: [PythonClientService],
})
export class PythonClientModule {}
