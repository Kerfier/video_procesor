import { Injectable, BadRequestException } from '@nestjs/common';
import * as path from 'path';
import { StreamsService } from './streams.service.js';

const LIVE_WINDOW = 5;
const FILENAME_RE = /^seg_\d{4}\.ts$/;

@Injectable()
export class HlsEgressService {
  constructor(private readonly streamsService: StreamsService) {}

  buildPlaylist(streamId: string): string {
    const session = this.streamsService.getSession(streamId);
    const { outputSegments, status, inputType } = session;

    const isLive = inputType === 'url';
    const window = isLive ? outputSegments.slice(-LIVE_WINDOW) : outputSegments;

    if (window.length === 0) {
      return (
        ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:2', `#EXT-X-MEDIA-SEQUENCE:0`].join(
          '\n',
        ) + '\n'
      );
    }

    const targetDuration = Math.ceil(Math.max(...window.map((s) => s.duration)));

    const lines: string[] = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${targetDuration}`,
      `#EXT-X-MEDIA-SEQUENCE:${window[0].sequence}`,
      ...(isLive ? [] : ['#EXT-X-PLAYLIST-TYPE:EVENT']),
    ];

    for (const seg of window) {
      lines.push(`#EXTINF:${seg.duration.toFixed(6)},`);
      lines.push(`/streams/${streamId}/segments/${seg.filename}`);
    }

    if (!isLive && status === 'done') {
      lines.push('#EXT-X-ENDLIST');
    }

    return lines.join('\n') + '\n';
  }

  getSegmentPath(streamId: string, filename: string): string {
    if (!FILENAME_RE.test(filename)) {
      throw new BadRequestException(`Invalid segment filename: ${filename}`);
    }
    const session = this.streamsService.getSession(streamId);
    return path.join(session.outputDir, filename);
  }
}
