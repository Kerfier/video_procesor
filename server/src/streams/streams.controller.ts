import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  HttpCode,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as os from 'os';
import { StreamsService } from './streams.service.js';
import { StartUrlDto } from './dto/start-url.dto.js';
import type { StreamStatusDto } from './dto/stream-status.dto.js';

@Controller('api/streams')
export class StreamsController {
  constructor(private readonly streamsService: StreamsService) {}

  @Post('start-url')
  async startUrl(@Body() body: StartUrlDto): Promise<{ streamId: string }> {
    const streamId = await this.streamsService.startUrl(body);
    return { streamId };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('video', { dest: os.tmpdir() }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Partial<StartUrlDto>,
  ): Promise<{ streamId: string }> {
    const streamId = await this.streamsService.startFile(file, body);
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
