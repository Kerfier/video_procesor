import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HlsEgressService } from './hls-egress.service.js';

@Controller('streams')
export class HlsEgressController {
  constructor(private readonly hlsEgress: HlsEgressService) {}

  @Get(':id/playlist.m3u8')
  getPlaylist(@Param('id') id: string, @Res() res: Response): void {
    const playlist = this.hlsEgress.buildPlaylist(id);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.send(playlist);
  }

  @Get(':id/segments/:filename')
  getSegment(
    @Param('id') id: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ): void {
    const filePath = this.hlsEgress.getSegmentPath(id, filename);
    res.setHeader('Content-Type', 'video/mp2t');
    res.sendFile(filePath);
  }
}
