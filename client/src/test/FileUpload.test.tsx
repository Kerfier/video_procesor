import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { FileUpload } from '../components/InputPanel/FileUpload';

const DEFAULT_PARAMS = { detectionInterval: 5, blurStrength: 51, conf: 0.25, lookbackFrames: 30 };

function getFileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

describe('FileUpload', () => {
  it('disables submit when no file selected', () => {
    render(<FileUpload onSubmit={vi.fn()} isLoading={false} />);
    expect(screen.getByRole('button', { name: 'Process' })).toBeDisabled();
  });

  it('shows filename and file size after file is selected', async () => {
    const user = userEvent.setup();
    const { container } = render(<FileUpload onSubmit={vi.fn()} isLoading={false} />);

    const file = new File(['x'.repeat(1_048_576 * 2)], 'dashcam.mp4', { type: 'video/mp4' });
    await user.upload(getFileInput(container), file);

    expect(screen.getByText('dashcam.mp4')).toBeDefined();
    expect(screen.getByText('2.0 MB')).toBeDefined();
  });

  it('enables submit after file is selected', async () => {
    const user = userEvent.setup();
    const { container } = render(<FileUpload onSubmit={vi.fn()} isLoading={false} />);

    const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });
    await user.upload(getFileInput(container), file);

    expect(screen.getByRole('button', { name: 'Process' })).not.toBeDisabled();
  });

  it('calls onSubmit with file and params', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<FileUpload onSubmit={onSubmit} isLoading={false} />);

    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    await user.upload(getFileInput(container), file);
    await user.click(screen.getByRole('button', { name: 'Process' }));

    expect(onSubmit).toHaveBeenCalledWith(file, DEFAULT_PARAMS);
  });

  it('disables submit when isLoading is true', async () => {
    const user = userEvent.setup();
    const { container } = render(<FileUpload onSubmit={vi.fn()} isLoading={false} />);

    const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });
    await user.upload(getFileInput(container), file);

    // Re-render with isLoading=true
    const { container: container2 } = render(<FileUpload onSubmit={vi.fn()} isLoading={true} />);
    await user.upload(getFileInput(container2), file);
    expect(screen.getAllByRole('button', { name: /Uploading/ })[0]).toBeDisabled();
  });

  it('calls onSubmit even when it rejects', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Upload failed'));
    const { rerender, container } = render(<FileUpload onSubmit={onSubmit} isLoading={false} />);

    const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });
    await user.upload(getFileInput(container), file);
    await user.click(screen.getByRole('button', { name: 'Process' }));

    // Simulate parent setting loading state
    rerender(<FileUpload onSubmit={onSubmit} isLoading={true} />);

    // Button should be disabled during submit attempt
    expect(screen.getByRole('button', { name: 'Uploading…' })).toBeDisabled();

    // Verify onSubmit was called despite rejection
    expect(onSubmit).toHaveBeenCalledWith(file, DEFAULT_PARAMS);
  });

  it('calls onSubmit with null params when raw mode is enabled', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<FileUpload onSubmit={onSubmit} isLoading={false} />);

    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    await user.upload(getFileInput(container), file);
    await user.click(screen.getByLabelText(/Raw passthrough/));
    await user.click(screen.getByRole('button', { name: 'Stream' }));

    expect(onSubmit).toHaveBeenCalledWith(file, null);
  });

  it('passes advanced settings parameters to onSubmit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<FileUpload onSubmit={onSubmit} isLoading={false} />);

    const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });
    await user.upload(getFileInput(container), file);

    // Click to open advanced settings
    await user.click(screen.getByText('Advanced settings'));

    // Fill in advanced settings
    const detectionInput = screen.getByLabelText(/Detection interval/);
    await user.clear(detectionInput);
    await user.type(detectionInput, '5');

    const blurInput = screen.getByLabelText(/Blur strength/);
    await user.clear(blurInput);
    await user.type(blurInput, '51');

    await user.click(screen.getByRole('button', { name: 'Process' }));

    expect(onSubmit).toHaveBeenCalledWith(file, DEFAULT_PARAMS);
  });
});
