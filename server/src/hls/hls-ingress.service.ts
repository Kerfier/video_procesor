import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as hlsParser from 'hls-parser';
import type { MediaPlaylist } from 'hls-parser/types.js';
import type { VideoProbeResult, SegmentCallback } from '../types.js';
import { sleep } from '../common/sleep.js';
import { probeVideo, runFfmpegSegment } from '../ffmpeg/ffmpeg.js';

@Injectable()
export class HlsIngressService {
  constructor(private readonly config: ConfigService) {}

  probeFile(filePath: string): Promise<VideoProbeResult> {
    return probeVideo(filePath, this.config.get<string>('FFPROBE_PATH'));
  }

  async segmentAndStream(
    filePath: string,
    onSegment: SegmentCallback,
    signal?: AbortSignal,
  ): Promise<void> {
    const outDir = path.join(os.tmpdir(), `hls-${randomUUID()}`);
    await fs.promises.mkdir(outDir, { recursive: true });

    const m3u8Path = path.join(outDir, 'output.m3u8');
    const seenUris = new Set<string>();
    let sequence = 0;
    let ffmpegDone = false;

    const ffmpegPromise = runFfmpegSegment(
      filePath,
      outDir,
      this.config.get<string>('FFMPEG_PATH'),
      signal,
    ).finally(() => {
      ffmpegDone = true;
    });

    const drainPlaylist = async (): Promise<void> => {
      let m3u8Text: string;
      try {
        m3u8Text = await fs.promises.readFile(m3u8Path, 'utf8');
      } catch {
        // should be swallowed and ignored, because ffmpeg may not have finished writing the playlist
        // it will be picked up on the next poll
        return;
      }
      const playlist = hlsParser.parse(m3u8Text) as MediaPlaylist;
      for (const seg of playlist.segments) {
        if (seenUris.has(seg.uri)) {
          continue;
        }
        seenUris.add(seg.uri);
        const buffer = await fs.promises.readFile(path.join(outDir, seg.uri));
        onSegment({ buffer, duration: seg.duration, sequence: sequence++ });
      }
    };

    try {
      while (!ffmpegDone) {
        await sleep(this.config.getOrThrow<number>('STREAM_POLL_MS'), signal);
        await drainPlaylist();
      }
      await ffmpegPromise;
      await drainPlaylist();
    } finally {
      await fs.promises.rm(outDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
