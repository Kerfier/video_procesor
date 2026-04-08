interface BaseProcessingParams {
  detectionInterval: number;
  blurStrength: number;
  conf: number;
  lookbackFrames: number;
  trackerAlgorithm: string;
}

export type SessionParams = BaseProcessingParams & {
  mode: 'push';
  width: number;
  height: number;
  fps: number;
};

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

export enum StreamStatus {
  Starting = 'starting',
  Processing = 'processing',
  Done = 'done',
  Error = 'error',
}

export type SegmentCallback = (seg: SegmentInfo) => void;

export type UrlSessionParams = BaseProcessingParams & {
  mode: 'pull';
  url: string;
  outputDir: string;
};
