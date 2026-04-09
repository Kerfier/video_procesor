import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStream } from '../hooks/useStream';

// vi.hoisted ensures mock fns exist before vi.mock() runs
const mockStartUrlStream = vi.hoisted(() => vi.fn());
const mockUploadFileStream = vi.hoisted(() => vi.fn());
const mockUploadRawFileStream = vi.hoisted(() => vi.fn());
const mockGetStreamStatus = vi.hoisted(() => vi.fn());
const mockDeleteStream = vi.hoisted(() => vi.fn());

vi.mock('../api/streamsApi', () => ({
  startUrlStream: mockStartUrlStream,
  uploadFileStream: mockUploadFileStream,
  uploadRawFileStream: mockUploadRawFileStream,
  getStreamStatus: mockGetStreamStatus,
  deleteStream: mockDeleteStream,
}));

const advanceTime = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

// --- Helpers ---

const processingStatus = { status: 'processing' as const, segmentCount: 1 };
const doneStatus = { status: 'done' as const, segmentCount: 5 };

describe('useStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockDeleteStream.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with clean state', () => {
    const { result } = renderHook(() => useStream());
    expect(result.current.streamId).toBeNull();
    expect(result.current.statusResponse).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.startError).toBeNull();
  });

  describe('startUrl', () => {
    it('sets isLoading while request is in flight', async () => {
      let resolve!: (id: string) => void;
      mockStartUrlStream.mockReturnValue(
        new Promise<string>((r) => {
          resolve = r;
        }),
      );

      const { result } = renderHook(() => useStream());

      act(() => {
        void result.current.startUrl('https://example.com/stream.m3u8', {});
      });
      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolve('stream-1');
        await Promise.resolve();
      });
      expect(result.current.isLoading).toBe(false);
    });

    it('sets streamId on success', async () => {
      mockStartUrlStream.mockResolvedValue('stream-url-1');

      const { result } = renderHook(() => useStream());
      await act(async () => {
        await result.current.startUrl('https://example.com/stream.m3u8', {});
      });

      expect(result.current.streamId).toBe('stream-url-1');
      expect(result.current.startError).toBeNull();
    });

    it('sets startError on failure', async () => {
      mockStartUrlStream.mockRejectedValue(new Error('Connection refused'));

      const { result } = renderHook(() => useStream());
      await act(async () => {
        await result.current.startUrl('https://example.com/stream.m3u8', {});
      });

      expect(result.current.streamId).toBeNull();
      expect(result.current.startError).toBe('Connection refused');
      expect(result.current.isLoading).toBe(false);
    });

    it('uses fallback error message for non-Error throws', async () => {
      mockStartUrlStream.mockRejectedValue('raw string error');

      const { result } = renderHook(() => useStream());
      await act(async () => {
        await result.current.startUrl('https://example.com/stream.m3u8', {});
      });

      expect(result.current.startError).toBe('Failed to start stream');
    });
  });

  describe('uploadFile', () => {
    it('sets streamId on success', async () => {
      mockUploadFileStream.mockResolvedValue('stream-file-1');

      const { result } = renderHook(() => useStream());
      const file = new File(['data'], 'video.mp4');
      await act(async () => {
        await result.current.uploadFile(file, {});
      });

      expect(result.current.streamId).toBe('stream-file-1');
    });

    it('sets startError on failure', async () => {
      mockUploadFileStream.mockRejectedValue(new Error('Upload failed'));

      const { result } = renderHook(() => useStream());
      const file = new File(['data'], 'video.mp4');
      await act(async () => {
        await result.current.uploadFile(file, {});
      });

      expect(result.current.startError).toBe('Upload failed');
    });
  });

  describe('uploadRawFile', () => {
    it('sets streamId on success', async () => {
      mockUploadRawFileStream.mockResolvedValue('stream-raw-1');

      const { result } = renderHook(() => useStream());
      const file = new File(['data'], 'video.mp4');
      await act(async () => {
        await result.current.uploadRawFile(file);
      });

      expect(result.current.streamId).toBe('stream-raw-1');
    });
  });

  describe('polling integration', () => {
    it('updates statusResponse via polling', async () => {
      mockStartUrlStream.mockResolvedValue('stream-poll-1');
      mockGetStreamStatus.mockResolvedValue(processingStatus);

      const { result } = renderHook(() => useStream());
      await act(async () => {
        await result.current.startUrl('https://example.com/stream.m3u8', {});
      });

      await advanceTime(2_000);

      expect(result.current.statusResponse).toEqual(processingStatus);
    });
  });

  describe('stop', () => {
    it('resets state and calls deleteStream', async () => {
      mockStartUrlStream.mockResolvedValue('stream-stop-1');
      mockGetStreamStatus.mockResolvedValue(processingStatus);

      const { result } = renderHook(() => useStream());
      await act(async () => {
        await result.current.startUrl('https://example.com/stream.m3u8', {});
      });

      await act(async () => {
        await result.current.stop();
      });

      expect(result.current.streamId).toBeNull();
      expect(result.current.statusResponse).toBeNull();
      expect(result.current.startError).toBeNull();
      expect(mockDeleteStream).toHaveBeenCalledWith('stream-stop-1');
    });

    it('does not call deleteStream if no stream is active', async () => {
      const { result } = renderHook(() => useStream());

      await act(async () => {
        await result.current.stop();
      });

      expect(mockDeleteStream).not.toHaveBeenCalled();
    });

    it('swallows deleteStream errors', async () => {
      mockStartUrlStream.mockResolvedValue('stream-err-1');
      mockDeleteStream.mockRejectedValue(new Error('Server error'));

      const { result } = renderHook(() => useStream());
      await act(async () => {
        await result.current.startUrl('https://example.com/stream.m3u8', {});
      });

      await expect(
        act(async () => {
          await result.current.stop();
        }),
      ).resolves.not.toThrow();
    });

    it('stops polling after stop()', async () => {
      mockStartUrlStream.mockResolvedValue('stream-stop-2');
      mockGetStreamStatus.mockResolvedValue(processingStatus);

      const { result } = renderHook(() => useStream());
      await act(async () => {
        await result.current.startUrl('https://example.com/stream.m3u8', {});
      });
      await act(async () => {
        await result.current.stop();
      });

      const callCountAfterStop = mockGetStreamStatus.mock.calls.length;
      await advanceTime(6_000);

      expect(mockGetStreamStatus).toHaveBeenCalledTimes(callCountAfterStop);
    });
  });

  describe('state cleared between starts', () => {
    it('clears statusResponse when a new stream starts', async () => {
      mockStartUrlStream.mockResolvedValue('stream-1');
      mockGetStreamStatus.mockResolvedValue(doneStatus);

      const { result } = renderHook(() => useStream());
      await act(async () => {
        await result.current.startUrl('https://example.com/stream.m3u8', {});
      });
      await advanceTime(2_000);
      expect(result.current.statusResponse).toEqual(doneStatus);

      mockStartUrlStream.mockResolvedValue('stream-2');
      await act(async () => {
        await result.current.startUrl('https://example.com/stream.m3u8', {});
      });
      expect(result.current.statusResponse).toBeNull();
    });
  });
});
