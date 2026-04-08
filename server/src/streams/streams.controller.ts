import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  UploadedFile,
  UseInterceptors,
  ParseFilePipe,
  MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as os from 'os';
import * as path from 'path';
import { StreamsService } from './streams.service.js';
import { StartUrlDto } from './dto/start-url.dto.js';
import { UploadFileDto } from './dto/upload-file.dto.js';
import type { StreamStatusDto } from './dto/stream-status.dto.js';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB

const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.mkv', '.avi'];

function videoFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (err: Error | null, accept: boolean) => void,
) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTENSIONS.includes(ext)) {
    cb(null, true);
  } else {
    cb(new BadRequestException('Unsupported format. Allowed: MP4, MOV, MKV, AVI'), false);
  }
}

const videoInterceptor = () =>
  FileInterceptor('video', {
    dest: os.tmpdir(),
    limits: { fileSize: MAX_UPLOAD_BYTES },
    fileFilter: videoFileFilter,
  });

const videoFilePipe = () =>
  new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES })] });

@Controller('api/streams')
export class StreamsController {
  constructor(private readonly streamsService: StreamsService) {}

  @Post('start-url')
  async startUrl(@Body() body: StartUrlDto): Promise<{ streamId: string }> {
    const streamId = await this.streamsService.startUrl(body);
    return { streamId };
  }

  @Post('upload')
  @UseInterceptors(videoInterceptor())
  async upload(
    @UploadedFile(videoFilePipe()) file: Express.Multer.File,
    @Body() body: UploadFileDto,
  ): Promise<{ streamId: string }> {
    const streamId = await this.streamsService.startFile(file, body);
    return { streamId };
  }

  @Post('upload-raw')
  @UseInterceptors(videoInterceptor())
  async uploadRaw(
    @UploadedFile(videoFilePipe()) file: Express.Multer.File,
  ): Promise<{ streamId: string }> {
    const streamId = await this.streamsService.startFileRaw(file);
    return { streamId };
  }

  @Get(':id/status')
  getStatus(@Param('id') id: string): StreamStatusDto {
    return this.streamsService.getStatus(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async deleteStream(@Param('id') id: string): Promise<void> {
    await this.streamsService.deleteStream(id);
  }
}
