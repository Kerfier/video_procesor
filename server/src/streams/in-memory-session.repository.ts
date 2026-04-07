import { Injectable, NotFoundException } from '@nestjs/common';
import { StreamStatus, type OutputSegment } from '../types.js';
import type { ISessionRepository, StreamSession } from './session.repository.interface.js';

@Injectable()
export class InMemorySessionRepository implements ISessionRepository {
  private readonly sessions = new Map<string, StreamSession>();

  create(session: StreamSession): void {
    this.sessions.set(session.streamId, session);
  }

  get(streamId: string): StreamSession | undefined {
    return this.sessions.get(streamId);
  }

  getOrThrow(streamId: string): StreamSession {
    const session = this.sessions.get(streamId);
    if (!session) {
      throw new NotFoundException(`Stream ${streamId} not found`);
    }
    return session;
  }

  addSegment(streamId: string, segment: OutputSegment): void {
    this.sessions.get(streamId)?.outputSegments.push(segment);
  }

  setStatus(streamId: string, status: StreamStatus, error?: string): void {
    const session = this.sessions.get(streamId);
    if (!session) {
      return;
    }
    session.status = status;
    if (error !== undefined) {
      session.error = error;
    }
  }

  delete(streamId: string): void {
    this.sessions.delete(streamId);
  }

  values(): IterableIterator<StreamSession> {
    return this.sessions.values();
  }

  size(): number {
    return this.sessions.size;
  }
}
