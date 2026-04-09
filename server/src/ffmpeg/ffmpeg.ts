import { spawn } from 'child_process';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import type { VideoProbeResult } from '../types.js';

function tail(text: string, maxChars = 2000): string {
  return text.length <= maxChars ? text : `…${text.slice(-maxChars)}`;
}

function parseFps(rateStr: string): number {
  const parts = rateStr.split('/');
  const num = Number(parts[0]);
  const den = Number(parts[1]);
  if (!den || den === 0 || !num) {
    return 30;
  }
  return num / den;
}

export function probeVideo(filePath: string, ffprobeBin = 'ffprobe'): Promise<VideoProbeResult> {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_streams', filePath];
    const proc = spawn(ffprobeBin, args);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new BadRequestException(`ffprobe exited with code ${code}: ${tail(stderr)}`));
      }
      let parsed: {
        streams?: {
          codec_type?: string;
          width?: number;
          height?: number;
          avg_frame_rate?: string;
        }[];
      };
      try {
        parsed = JSON.parse(stdout) as typeof parsed;
      } catch {
        return reject(new BadRequestException(`ffprobe output is not valid JSON: ${stdout}`));
      }
      const stream = parsed.streams?.find((s) => s.codec_type === 'video');
      if (!stream) {
        return reject(new BadRequestException('No video stream found'));
      }
      resolve({
        width: stream.width ?? 0,
        height: stream.height ?? 0,
        fps: parseFps(stream.avg_frame_rate ?? '30/1'),
      });
    });

    proc.on('error', (err) => {
      reject(new BadRequestException(`ffprobe failed to start: ${err.message}`));
    });
  });
}

export function runFfmpegSegment(
  inputPath: string,
  outDir: string,
  ffmpegBin = 'ffmpeg',
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new Error('Aborted'));
    }
    const segmentFilename = path.join(outDir, 'seg_%04d.ts');
    const playlistPath = path.join(outDir, 'output.m3u8');
    const args = [
      '-i',
      inputPath,
      '-c',
      'copy',
      '-hls_time',
      '2',
      '-hls_list_size',
      '0',
      '-hls_segment_filename',
      segmentFilename,
      playlistPath,
    ];
    const proc = spawn(ffmpegBin, args);

    const onAbort = () => {
      proc.kill();
      reject(new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    let stderr = '';
    proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        return;
      }
      if (code !== 0) {
        return reject(
          new BadRequestException(`ffmpeg segmentation failed (exit ${code}): ${tail(stderr)}`),
        );
      }
      resolve();
    });

    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(new BadRequestException(`ffmpeg failed to start: ${err.message}`));
    });
  });
}
