import { plainToInstance } from 'class-transformer';
import { IsNumber, IsString, IsUrl, IsOptional, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsOptional()
  @IsNumber()
  PORT: number = 3000;

  @IsOptional()
  @IsUrl({ require_tld: false })
  PYTHON_SERVICE_URL: string = 'http://localhost:8000';

  @IsOptional()
  @IsString()
  OUTPUT_DIR: string = '/tmp/streams';

  @IsOptional()
  @IsNumber()
  PYTHON_TIMEOUT_MS: number = 120_000;

  @IsOptional()
  @IsNumber()
  STREAM_POLL_MS: number = 500;

  @IsOptional()
  @IsNumber()
  SHUTDOWN_DRAIN_TIMEOUT_MS: number = 10_000;

  @IsOptional()
  @IsNumber()
  HLS_SEGMENT_DURATION: number = 2;

  @IsOptional()
  @IsString()
  FFMPEG_PATH: string = 'ffmpeg';

  @IsOptional()
  @IsString()
  FFPROBE_PATH: string = 'ffprobe';
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validated;
}
