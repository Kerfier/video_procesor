import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusBadge } from '../components/StatusBadge/StatusBadge';

describe('StatusBadge', () => {
  it('renders processing status with segment count', () => {
    render(<StatusBadge status="processing" segmentCount={3} />);
    expect(screen.getByText('Processing')).toBeDefined();
    expect(screen.getByText('3 segments')).toBeDefined();
  });

  it('renders done status', () => {
    render(<StatusBadge status="done" segmentCount={10} />);
    expect(screen.getByText('Complete')).toBeDefined();
  });

  it('renders error status with error message', () => {
    render(<StatusBadge status="error" segmentCount={2} error="Python service unavailable" />);
    expect(screen.getByText('Error')).toBeDefined();
    expect(screen.getByText('Python service unavailable')).toBeDefined();
  });

  it('does not render error paragraph when no error', () => {
    render(<StatusBadge status="processing" segmentCount={1} />);
    expect(screen.queryByText('Python service unavailable')).toBeNull();
  });

  it('uses singular "segment" for count of 1', () => {
    render(<StatusBadge status="done" segmentCount={1} />);
    expect(screen.getByText('1 segment')).toBeDefined();
  });

  it('sets data-status attribute for CSS color targeting', () => {
    const { container } = render(<StatusBadge status="error" segmentCount={0} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.getAttribute('data-status')).toBe('error');
  });
});
