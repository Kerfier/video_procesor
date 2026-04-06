import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStatusPoller } from '../hooks/useStatusPoller';

// vi.hoisted ensures the mock fn exists before vi.mock() runs
const mockGetStreamStatus = vi.hoisted(() => vi.fn());
vi.mock('../api/streamsApi', () => ({
  getStreamStatus: mockGetStreamStatus,
}));

const advanceTime = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('useStatusPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not poll when streamId is null', async () => {
    const onStatus = vi.fn();
    renderHook(() => useStatusPoller(null, onStatus));

    await advanceTime(6_000);

    expect(mockGetStreamStatus).not.toHaveBeenCalled();
  });

  it('polls every 2 seconds when streamId is set', async () => {
    mockGetStreamStatus.mockResolvedValue({ status: 'processing', segmentCount: 1 });
    const onStatus = vi.fn();

    renderHook(() => useStatusPoller('stream-1', onStatus));

    await advanceTime(2_000);
    expect(mockGetStreamStatus).toHaveBeenCalledTimes(1);
    expect(mockGetStreamStatus).toHaveBeenCalledWith('stream-1');

    await advanceTime(2_000);
    expect(mockGetStreamStatus).toHaveBeenCalledTimes(2);
  });

  it('calls onStatus with the response', async () => {
    const response = { status: 'processing' as const, segmentCount: 3 };
    mockGetStreamStatus.mockResolvedValue(response);
    const onStatus = vi.fn();

    renderHook(() => useStatusPoller('stream-1', onStatus));

    await advanceTime(2_000);

    expect(onStatus).toHaveBeenCalledWith(response);
  });

  it('stops polling when status is done', async () => {
    mockGetStreamStatus.mockResolvedValue({ status: 'done', segmentCount: 5 });
    const onStatus = vi.fn();

    renderHook(() => useStatusPoller('stream-1', onStatus));

    await advanceTime(2_000);
    const callCount = mockGetStreamStatus.mock.calls.length;

    await advanceTime(6_000);
    // No additional calls after done
    expect(mockGetStreamStatus).toHaveBeenCalledTimes(callCount);
  });

  it('stops polling when status is error', async () => {
    mockGetStreamStatus.mockResolvedValue({ status: 'error', segmentCount: 0 });
    const onStatus = vi.fn();

    renderHook(() => useStatusPoller('stream-1', onStatus));

    await advanceTime(2_000);
    const callCount = mockGetStreamStatus.mock.calls.length;

    await advanceTime(6_000);
    expect(mockGetStreamStatus).toHaveBeenCalledTimes(callCount);
  });

  it('stopPolling halts the interval immediately', async () => {
    mockGetStreamStatus.mockResolvedValue({ status: 'processing', segmentCount: 1 });
    const onStatus = vi.fn();

    const { result } = renderHook(() => useStatusPoller('stream-1', onStatus));

    await advanceTime(2_000);
    expect(mockGetStreamStatus).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.stopPolling();
    });

    await advanceTime(6_000);
    expect(mockGetStreamStatus).toHaveBeenCalledTimes(1);
  });

  it('cleans up on unmount', async () => {
    mockGetStreamStatus.mockResolvedValue({ status: 'processing', segmentCount: 1 });
    const onStatus = vi.fn();

    const { unmount } = renderHook(() => useStatusPoller('stream-1', onStatus));

    unmount();

    await advanceTime(6_000);
    expect(mockGetStreamStatus).not.toHaveBeenCalled();
  });

  it('swallows network errors without crashing', async () => {
    mockGetStreamStatus.mockRejectedValue(new Error('Network error'));
    const onStatus = vi.fn();

    const { unmount } = renderHook(() => useStatusPoller('stream-1', onStatus));

    await expect(advanceTime(2_000)).resolves.not.toThrow();

    unmount();
  });
});
