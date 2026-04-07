import { IsOptional, IsInt, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class UploadFileDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  detectionInterval?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  blurStrength?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  conf?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lookbackFrames?: number;
}
