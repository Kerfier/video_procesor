import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance, isAxiosError } from 'axios';
import type { SessionParams } from '../types.js';

@Injectable()
export class PythonClientService {
  private readonly logger = new Logger(PythonClientService.name);
  private readonly client: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    const baseURL = this.config.get<string>('PYTHON_SERVICE_URL') ?? 'http://localhost:8000';
    this.client = axios.create({ baseURL });
  }

  async createSession(params: SessionParams): Promise<string> {
    try {
      const res = await this.client.post<{ session_id: string }>('/sessions', {
        detection_interval: params.detectionInterval,
        blur_strength: params.blurStrength,
        conf: params.conf,
        lookback_frames: params.lookbackFrames,
        width: params.width,
        height: params.height,
        fps: params.fps,
      });
      return res.data.session_id;
    } catch (err) {
      this.handleError('createSession', err);
    }
  }

  async processSegment(sessionId: string, tsBuffer: Buffer): Promise<Buffer> {
    const form = new FormData();
    form.append('segment', new Blob([tsBuffer], { type: 'video/mp2t' }), 'segment.ts');
    try {
      const res = await this.client.post<ArrayBuffer>(`/sessions/${sessionId}/segment`, form, {
        responseType: 'arraybuffer',
      });
      return Buffer.from(res.data);
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 404) {
        throw new NotFoundException(`Python session ${sessionId} not found`);
      }
      this.handleError('processSegment', err);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.client.delete(`/sessions/${sessionId}`);
    } catch (err) {
      // Log but don't throw — deletion is best-effort
      this.logger.warn(`Failed to delete Python session ${sessionId}: ${String(err)}`);
    }
  }

  private handleError(method: string, err: unknown): never {
    if (isAxiosError(err) && err.response) {
      const status = err.response.status;
      if (status >= 500) {
        throw new InternalServerErrorException(
          `Python service error in ${method}: ${String(err.message)}`,
        );
      }
      throw new InternalServerErrorException(
        `Python service ${method} failed with status ${status}`,
      );
    }
    throw new InternalServerErrorException(`Python service ${method} unreachable: ${String(err)}`);
  }
}
