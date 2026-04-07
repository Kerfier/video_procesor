import { Controller, Get, Logger, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HlsEgressService } from './hls-egress.service.js';

@Controller('streams')
export class HlsEgressController {
  private readonly logger = new Logger(HlsEgressController.name);

  constructor(private readonly hlsEgress: HlsEgressService) {}

  @Get(':id/playlist.m3u8')
  getPlaylist(@Param('id') id: string, @Res() res: Response): void {
    try {
      const playlist = this.hlsEgress.buildPlaylist(id);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store');
      res.send(playlist);
    } catch (err) {
      this.logger.error(`Failed to build playlist for stream ${id}: ${String(err)}`);
      throw err;
    }
  }

  @Get(':id/segments/:filename')
  getSegment(
    @Param('id') id: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ): void {
    try {
      const filePath = this.hlsEgress.getSegmentPath(id, filename);
      res.setHeader('Content-Type', 'video/mp2t');
      res.sendFile(filePath);
    } catch (err) {
      this.logger.error(`Failed to serve segment ${filename} for stream ${id}: ${String(err)}`);
      throw err;
    }
  }
}
