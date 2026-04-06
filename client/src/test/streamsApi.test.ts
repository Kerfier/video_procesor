import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startUrlStream, uploadFileStream, getStreamStatus, deleteStream } from '../api/streamsApi';

// Create mock API instance with vi.hoisted so it's available before module load
const mockApi = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return {
    default: {
      ...actual.default,
      create: vi.fn(() => mockApi),
      isAxiosError: actual.default.isAxiosError,
    },
  };
});

describe('streamsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('startUrlStream', () => {
    it('posts to /api/streams/start-url with url and params', async () => {
      mockApi.post.mockResolvedValueOnce({ data: { streamId: 'abc123' } });

      const result = await startUrlStream('https://example.com/stream.m3u8', {
        detectionInterval: 3,
      });

      expect(mockApi.post).toHaveBeenCalledWith('/api/streams/start-url', {
        url: 'https://example.com/stream.m3u8',
        detectionInterval: 3,
      });
      expect(result).toBe('abc123');
    });

    it('works without optional params', async () => {
      mockApi.post.mockResolvedValueOnce({ data: { streamId: 'xyz' } });

      const result = await startUrlStream('https://example.com/stream.m3u8');
      expect(result).toBe('xyz');
    });
  });

  describe('uploadFileStream', () => {
    it('calls post with FormData containing the file', async () => {
      mockApi.post.mockResolvedValueOnce({ data: { streamId: 'upload1' } });

      const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });
      const appendSpy = vi.spyOn(FormData.prototype, 'append');

      const result = await uploadFileStream(file, { blurStrength: 51 });

      expect(result).toBe('upload1');
      expect(appendSpy).toHaveBeenCalledWith('video', file, 'test.mp4');
      expect(appendSpy).toHaveBeenCalledWith('blurStrength', '51');
      // conf was not provided — should NOT be appended
      const appendedKeys = appendSpy.mock.calls.map((c) => c[0]);
      expect(appendedKeys).not.toContain('conf');
    });
  });

  describe('getStreamStatus', () => {
    it('gets status from correct URL', async () => {
      mockApi.get.mockResolvedValueOnce({ data: { status: 'processing', segmentCount: 2 } });

      const result = await getStreamStatus('stream99');
      expect(mockApi.get).toHaveBeenCalledWith('/api/streams/stream99/status');
      expect(result).toEqual({ status: 'processing', segmentCount: 2 });
    });
  });

  describe('deleteStream', () => {
    it('sends DELETE to correct URL', async () => {
      mockApi.delete.mockResolvedValueOnce({});

      await deleteStream('stream42');
      expect(mockApi.delete).toHaveBeenCalledWith('/api/streams/stream42');
    });

    it('swallows 404 errors silently', async () => {
      const error = Object.assign(new Error('Not Found'), {
        isAxiosError: true,
        response: { status: 404 },
      });
      mockApi.delete.mockRejectedValueOnce(error);

      await expect(deleteStream('missing')).resolves.toBeUndefined();
    });
  });
});
