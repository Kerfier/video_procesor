import { IsUrl, IsOptional, IsInt, IsNumber, Min, Max } from 'class-validator';

export class StartUrlDto {
  @IsUrl()
  url: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  detectionInterval?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  blurStrength?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  conf?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lookbackFrames?: number;
}
