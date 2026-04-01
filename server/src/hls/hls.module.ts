import { Module } from '@nestjs/common';
import { HlsIngressService } from './hls-ingress.service.js';

@Module({
  providers: [HlsIngressService],
  exports: [HlsIngressService],
})
export class HlsModule {}
