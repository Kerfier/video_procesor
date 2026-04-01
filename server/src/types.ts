export interface SessionParams {
  detectionInterval: number;
  blurStrength: number;
  conf: number;
  lookbackFrames: number;
  width: number;
  height: number;
  fps: number;
}

export interface VideoProbeResult {
  width: number;
  height: number;
  fps: number;
}

export interface SegmentInfo {
  buffer: Buffer;
  duration: number;
  sequence: number;
}

export interface OutputSegment {
  filename: string;
  duration: number;
  sequence: number;
}

export type StreamStatus = 'starting' | 'processing' | 'done' | 'error';

export type SegmentCallback = (seg: SegmentInfo) => void;
