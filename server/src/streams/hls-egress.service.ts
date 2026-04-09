import { Injectable, BadRequestException, Inject, Logger } from '@nestjs/common';
import * as path from 'path';
import * as hlsParser from 'hls-parser';
import { MediaPlaylist } from 'hls-parser/types.js';
import { StreamStatus } from '../types.js';
import { SESSION_REPOSITORY, type ISessionRepository } from './session.repository.interface.js';

const LIVE_WINDOW = 5;
const FILENAME_RE = /^seg_\d{4}\.ts$/;

@Injectable()
export class HlsEgressService {
  private readonly logger = new Logger(HlsEgressService.name);

  constructor(@Inject(SESSION_REPOSITORY) private readonly repo: ISessionRepository) {}

  buildPlaylist(streamId: string): string {
    this.logger.verbose(`Building playlist for stream ${streamId}`);
    const session = this.repo.getOrThrow(streamId);
    const { outputSegments, status, inputType } = session;

    const isLive = inputType === 'url';
    const window = isLive ? outputSegments.slice(-LIVE_WINDOW) : outputSegments;
    const targetDuration =
      window.length > 0 ? Math.ceil(Math.max(...window.map((s) => s.duration))) : 2;

    const playlist = new MediaPlaylist({
      version: 3,
      targetDuration,
      mediaSequenceBase: window.length > 0 ? window[0].sequence : 0,
      playlistType: isLive ? undefined : 'EVENT',
      endlist: !isLive && status === StreamStatus.Done,
      segments: window.map(
        (seg) =>
          new hlsParser.types.Segment({
            uri: `/streams/${streamId}/segments/${seg.filename}`,
            duration: seg.duration,
            discontinuity: true,
          }),
      ),
    });

    return hlsParser.stringify(playlist);
  }

  getSegmentPath(streamId: string, filename: string): string {
    if (!FILENAME_RE.test(filename)) {
      this.logger.warn(`Invalid segment filename requested for stream ${streamId}: ${filename}`);
      throw new BadRequestException(`Invalid segment filename: ${filename}`);
    }
    this.logger.verbose(`Serving segment ${filename} for stream ${streamId}`);
    const session = this.repo.getOrThrow(streamId);
    return path.join(session.outputDir, filename);
  }
}
