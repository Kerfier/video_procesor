import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { StreamsModule } from './streams/streams.module';
import { HlsModule } from './hls/hls.module';
import { PythonClientModule } from './python-client/python-client.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'client', 'dist'),
      exclude: ['/api/(.*)'],
    }),
    StreamsModule,
    HlsModule,
    PythonClientModule,
  ],
})
export class AppModule {}
