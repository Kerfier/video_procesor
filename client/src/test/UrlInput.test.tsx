import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { UrlInput } from '../components/InputPanel/UrlInput';

const DEFAULT_PARAMS = { detectionInterval: 10, blurStrength: 51, conf: 0.25, lookbackFrames: 20 };

describe('UrlInput', () => {
  it('disables submit when URL is empty', () => {
    render(<UrlInput onSubmit={vi.fn()} isLoading={false} />);
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('enables submit when URL is typed', async () => {
    const user = userEvent.setup();
    render(<UrlInput onSubmit={vi.fn()} isLoading={false} />);
    await user.type(screen.getByRole('textbox'), 'https://example.com/stream.m3u8');
    expect(screen.getByRole('button', { name: 'Start' })).not.toBeDisabled();
  });

  it('calls onSubmit with trimmed URL on submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<UrlInput onSubmit={onSubmit} isLoading={false} />);
    await user.type(screen.getByRole('textbox'), '  https://example.com/stream.m3u8  ');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(onSubmit).toHaveBeenCalledWith('https://example.com/stream.m3u8', DEFAULT_PARAMS);
  });

  it('disables submit when isLoading is true', () => {
    render(<UrlInput onSubmit={vi.fn()} isLoading={true} />);
    expect(screen.getByRole('button', { name: /Starting/ })).toBeDisabled();
  });

  it('toggles advanced settings panel', async () => {
    const user = userEvent.setup();
    render(<UrlInput onSubmit={vi.fn()} isLoading={false} />);

    expect(screen.queryByText('Detection interval')).toBeNull();
    await user.click(screen.getByText('Advanced settings'));
    expect(screen.getByText('Detection interval')).toBeDefined();
    await user.click(screen.getByText('Advanced settings'));
    expect(screen.queryByText('Detection interval')).toBeNull();
  });

  it('calls onSubmit even when it rejects', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Stream failed'));
    const { rerender } = render(<UrlInput onSubmit={onSubmit} isLoading={false} />);

    await user.type(screen.getByRole('textbox'), 'https://example.com/stream.m3u8');
    await user.click(screen.getByRole('button', { name: 'Start' }));

    // Simulate parent setting loading state
    rerender(<UrlInput onSubmit={onSubmit} isLoading={true} />);

    // Button should be disabled during submit attempt
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();

    // Verify onSubmit was called despite rejection
    expect(onSubmit).toHaveBeenCalledWith('https://example.com/stream.m3u8', DEFAULT_PARAMS);
  });

  it('passes advanced settings parameters to onSubmit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<UrlInput onSubmit={onSubmit} isLoading={false} />);

    await user.type(screen.getByRole('textbox'), 'https://example.com/stream.m3u8');

    // Click to open advanced settings
    await user.click(screen.getByText('Advanced settings'));

    // Fill in advanced settings
    const detectionInput = screen.getByLabelText(/Detection interval/);
    await user.clear(detectionInput);
    await user.type(detectionInput, '10');

    const blurInput = screen.getByLabelText(/Blur strength/);
    await user.clear(blurInput);
    await user.type(blurInput, '51');

    await user.click(screen.getByRole('button', { name: 'Start' }));

    expect(onSubmit).toHaveBeenCalledWith('https://example.com/stream.m3u8', {
      ...DEFAULT_PARAMS,
      detectionInterval: 10,
    });
  });
});
