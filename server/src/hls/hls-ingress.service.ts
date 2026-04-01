import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import * as hlsParser from 'hls-parser';
import type { MediaPlaylist } from 'hls-parser/types.js';
import type { VideoProbeResult, SegmentCallback } from '../types.js';

function parseFps(rateStr: string): number {
  const parts = rateStr.split('/');
  const num = Number(parts[0]);
  const den = Number(parts[1]);
  if (!den || den === 0 || !num) return 30;
  return num / den;
}

function resolveUri(segUri: string, playlistUrl: string): string {
  if (/^https?:\/\//i.test(segUri)) return segUri;
  return new URL(segUri, playlistUrl).toString();
}

@Injectable()
export class HlsIngressService {
  private readonly logger = new Logger(HlsIngressService.name);

  probeFile(filePath: string): Promise<VideoProbeResult> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err) return reject(new BadRequestException(`ffprobe failed: ${String(err)}`));
        const stream = data.streams.find((s) => s.codec_type === 'video');
        if (!stream) return reject(new BadRequestException('No video stream found'));
        const fps = parseFps(stream.avg_frame_rate ?? '30/1');
        resolve({ width: stream.width ?? 0, height: stream.height ?? 0, fps });
      });
    });
  }

  async probeUrl(url: string): Promise<VideoProbeResult> {
    const playlist = await this.fetchMediaPlaylist(url);
    const firstSeg = playlist.segments[0];
    if (!firstSeg) throw new BadRequestException('Playlist has no segments');

    const segUrl = resolveUri(firstSeg.uri, url);
    const res = await axios.get<ArrayBuffer>(segUrl, { responseType: 'arraybuffer' });
    const tmpPath = path.join(os.tmpdir(), `probe-${randomUUID()}.ts`);
    await fs.promises.writeFile(tmpPath, Buffer.from(res.data));
    try {
      return await this.probeFile(tmpPath);
    } finally {
      await fs.promises.unlink(tmpPath).catch(() => undefined);
    }
  }

  async streamUrl(url: string, onSegment: SegmentCallback, signal: AbortSignal): Promise<void> {
    const seenUris = new Set<string>();
    let sequence = 0;
    let mediaUrl = url;

    // Resolve master → media playlist once
    const initial = await this.fetchPlaylistText(url);
    const parsed = hlsParser.parse(initial);
    if (parsed.isMasterPlaylist) {
      const master = parsed;
      const best = [...master.variants].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
      if (!best) throw new BadRequestException('Master playlist has no variants');
      mediaUrl = resolveUri(best.uri, url);
    }

    while (!signal.aborted) {
      const text = await this.fetchPlaylistText(mediaUrl);
      const media = hlsParser.parse(text) as MediaPlaylist;
      const targetDuration = media.targetDuration ?? 2;

      for (const seg of media.segments) {
        if (signal.aborted) break;
        if (seenUris.has(seg.uri)) continue;
        seenUris.add(seg.uri);

        const segUrl = resolveUri(seg.uri, mediaUrl);
        const res = await axios.get<ArrayBuffer>(segUrl, { responseType: 'arraybuffer' });
        onSegment({
          buffer: Buffer.from(res.data),
          duration: seg.duration,
          sequence: sequence++,
        });
      }

      if (media.endlist) break;
      await this.sleep(targetDuration * 1000, signal);
    }
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
        if (seenUris.has(seg.uri)) continue;
        seenUris.add(seg.uri);
        const buffer = await fs.promises.readFile(path.join(outDir, seg.uri));
        onSegment({ buffer, duration: seg.duration, sequence: sequence++ });
      }
    };

    try {
      while (!ffmpegDone) {
        await this.sleep(500);
        await drainPlaylist();
      }
      await ffmpegPromise; // surface any FFmpeg error
      await drainPlaylist(); // pick up segments added between last poll and process exit
    } finally {
      await fs.promises.rm(outDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async fetchPlaylistText(url: string): Promise<string> {
    const res = await axios.get<string>(url, { responseType: 'text' });
    return res.data;
  }

  private async fetchMediaPlaylist(url: string): Promise<MediaPlaylist> {
    const text = await this.fetchPlaylistText(url);
    const parsed = hlsParser.parse(text);
    if (parsed.isMasterPlaylist) {
      const master = parsed;
      const best = [...master.variants].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
      if (!best) throw new BadRequestException('Master playlist has no variants');
      const mediaUrl = resolveUri(best.uri, url);
      const mediaText = await this.fetchPlaylistText(mediaUrl);
      return hlsParser.parse(mediaText) as MediaPlaylist;
    }
    return parsed;
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

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
