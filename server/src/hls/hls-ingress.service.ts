import { Injectable, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import * as hlsParser from 'hls-parser';
import type { MediaPlaylist } from 'hls-parser/types.js';
import type { VideoProbeResult, SegmentCallback } from '../types.js';
import { sleep } from '../common/sleep.js';

function parseFps(rateStr: string): number {
  const parts = rateStr.split('/');
  const num = Number(parts[0]);
  const den = Number(parts[1]);
  if (!den || den === 0 || !num) {
    return 30;
  }
  return num / den;
}

@Injectable()
export class HlsIngressService {
  probeFile(filePath: string): Promise<VideoProbeResult> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err) {
          return reject(new BadRequestException(`ffprobe failed: ${String(err)}`));
        }
        const stream = data.streams.find((s) => s.codec_type === 'video');
        if (!stream) {
          return reject(new BadRequestException('No video stream found'));
        }
        const fps = parseFps(stream.avg_frame_rate ?? '30/1');
        resolve({ width: stream.width ?? 0, height: stream.height ?? 0, fps });
      });
    });
  }

  async segmentAndStream(filePath: string, onSegment: SegmentCallback): Promise<void> {
    const outDir = path.join(os.tmpdir(), `hls-${randomUUID()}`);
    await fs.promises.mkdir(outDir, { recursive: true });

    const m3u8Path = path.join(outDir, 'output.m3u8');
    const seenUris = new Set<string>();
    let sequence = 0;
    let ffmpegDone = false;

    const ffmpegPromise = this.runFfmpegSegment(filePath, outDir).finally(() => {
      ffmpegDone = true;
    });

    const drainPlaylist = async (): Promise<void> => {
      let m3u8Text: string;
      try {
        m3u8Text = await fs.promises.readFile(m3u8Path, 'utf8');
      } catch {
        return; // not written yet
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
        await sleep(500);
        await drainPlaylist();
      }
      await ffmpegPromise; // surface any FFmpeg error
      await drainPlaylist(); // pick up segments added between last poll and process exit
    } finally {
      await fs.promises.rm(outDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private runFfmpegSegment(inputPath: string, outDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-preset veryfast',
          '-crf 23',
          '-c:a aac',
          '-hls_time 2',
          '-hls_list_size 0',
          `-hls_segment_filename ${path.join(outDir, 'seg_%04d.ts')}`,
        ])
        .output(path.join(outDir, 'output.m3u8'))
        .on('end', () => resolve())
        .on('error', (err: Error) =>
          reject(new BadRequestException(`ffmpeg segmentation failed: ${err.message}`)),
        )
        .run();
    });
  }
}
