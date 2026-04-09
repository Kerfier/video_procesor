import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HttpHealthIndicator } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly http: HttpHealthIndicator,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @HealthCheck()
  liveness() {
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  readiness() {
    const serviceUrl = this.config.get<string>('PYTHON_SERVICE_URL') ?? 'http://localhost:8000';
    return this.health.check([
      () => this.http.pingCheck('anonymization-service', `${serviceUrl}/health`),
    ]);
  }
}
