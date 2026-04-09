import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { LoggingInterceptor } from './common/logging.interceptor.js';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, context, stack }) => {
          const ctx = typeof context === 'string' ? context : '';
          const msg = typeof message === 'string' ? message : String(message);
          const st = typeof stack === 'string' ? stack : '';
          return `${timestamp as string} [${level}]${ctx ? ' [' + ctx + ']' : ''} ${msg}${st ? '\n' + st : ''}`;
        }),
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'server.log' }),
      ],
    }),
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new ClassSerializerInterceptor(app.get(Reflector)),
  );
  app.enableShutdownHooks();

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  console.log(`Server listening on port ${port}`);
}
bootstrap().catch(console.error);
