import { describe, it, expect } from 'vitest';
import { formatBytes, getExtension, isAllowed } from '../utils/file';

// These utilities were extracted from useFileInput and are the testable core of its logic.

describe('formatBytes', () => {
  it('formats bytes to MB with one decimal', () => {
    expect(formatBytes(1_048_576)).toBe('1.0 MB');
    expect(formatBytes(2_097_152)).toBe('2.0 MB');
    expect(formatBytes(1_572_864)).toBe('1.5 MB');
  });

  it('handles small files', () => {
    expect(formatBytes(512)).toBe('0.0 MB');
  });
});

describe('getExtension', () => {
  it('returns lower-cased extension', () => {
    expect(getExtension('video.MP4')).toBe('.mp4');
    expect(getExtension('clip.mov')).toBe('.mov');
    expect(getExtension('archive.tar.gz')).toBe('.gz');
  });
});

describe('isAllowed', () => {
  const makeFile = (name: string) => new File([], name);

  it('allows supported video formats', () => {
    expect(isAllowed(makeFile('video.mp4'))).toBe(true);
    expect(isAllowed(makeFile('clip.mov'))).toBe(true);
    expect(isAllowed(makeFile('movie.mkv'))).toBe(true);
    expect(isAllowed(makeFile('old.avi'))).toBe(true);
  });

  it('allows upper-case extensions', () => {
    expect(isAllowed(makeFile('VIDEO.MP4'))).toBe(true);
  });

  it('rejects unsupported formats', () => {
    expect(isAllowed(makeFile('doc.pdf'))).toBe(false);
    expect(isAllowed(makeFile('audio.mp3'))).toBe(false);
    expect(isAllowed(makeFile('image.jpg'))).toBe(false);
    expect(isAllowed(makeFile('noextension'))).toBe(false);
  });
});
