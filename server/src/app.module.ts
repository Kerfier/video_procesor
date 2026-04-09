import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { validate } from './config/env.validation';
import { StreamsModule } from './streams/streams.module';
import { HlsModule } from './hls/hls.module';
import { AnonymizationClientModule } from './anonymization-client/anonymization-client.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'client', 'dist'),
      exclude: ['/api/(.*)'],
    }),
    StreamsModule,
    HlsModule,
    AnonymizationClientModule,
    HealthModule,
  ],
})
export class AppModule {}
