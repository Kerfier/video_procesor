import type { OutputSegment, StreamStatus } from '../types.js';

export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

// p-queue is ESM-only — use this minimal interface everywhere instead of the concrete class.
export interface IQueue {
  add(fn: () => Promise<void>): Promise<void>;
  clear(): void;
  onIdle(): Promise<void>;
}

export interface StreamSession {
  streamId: string;
  anonymizationSessionId?: string;
  status: StreamStatus;
  inputType: 'url' | 'file';
  outputDir: string;
  outputSegments: OutputSegment[];
  segmentQueue: IQueue | null; // null for URL pull sessions
  abortController: AbortController;
  error?: string;
}

export interface ISessionRepository {
  create(session: StreamSession): void;
  get(streamId: string): StreamSession | undefined;
  getOrThrow(streamId: string): StreamSession;
  setStatus(streamId: string, status: StreamStatus, error?: string): void;
  addSegment(streamId: string, segment: OutputSegment): void;
  delete(streamId: string): void;
  values(): IterableIterator<StreamSession>;
}
