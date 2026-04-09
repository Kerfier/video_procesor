import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { RequestContext } from './request-context.js';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const { method, url } = req;
    const start = Date.now();

    return new Observable((subscriber) => {
      RequestContext.run(() => {
        const requestId = RequestContext.getRequestId();
        next
          .handle()
          .pipe(
            tap({
              next: () => {
                this.logger.log(
                  `[${requestId}] ${method} ${url} ${res.statusCode} +${Date.now() - start}ms`,
                );
              },
              error: () => {
                this.logger.log(
                  `[${requestId}] ${method} ${url} ${res.statusCode} +${Date.now() - start}ms`,
                );
              },
            }),
          )
          .subscribe(subscriber);
      });
    });
  }
}
