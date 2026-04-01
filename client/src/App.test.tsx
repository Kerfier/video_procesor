import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from './App';

vi.mock('./hooks/useStream', () => ({
  useStream: () => ({
    streamId: null,
    statusResponse: null,
    isLoading: false,
    startError: null,
    startUrl: vi.fn(),
    uploadFile: vi.fn(),
    stop: vi.fn(),
  }),
}));

// hls.js requires a real browser media pipeline — stub it in jsdom
vi.mock('hls.js', () => ({
  default: class {
    static isSupported() { return false; }
    on() {}
    loadSource() {}
    attachMedia() {}
    destroy() {}
  },
}));

describe('App', () => {
  it('renders the heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /video-processor/i })).toBeDefined();
  });

  it('does not render StatusBadge initially', () => {
    render(<App />);
    expect(screen.queryByText(/Processing|Complete|Error/)).toBeNull();
  });

  it('does not render StreamPlayer initially', () => {
    render(<App />);
    expect(screen.queryByRole('region', { name: /stream/i })).toBeNull();
  });
});
