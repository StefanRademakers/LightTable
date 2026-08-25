import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { VideoDocumentSession, type VideoDocumentId } from '@lighttable/video-core';
import { VideoControlsPanel } from './VideoControlsPanel';

describe('VideoControlsPanel', () => {
  it('projects shared playback state into transport, volume and scrub controls', () => {
    const session = new VideoDocumentSession({
      id: 'video-test' as VideoDocumentId,
      source: { id: 'source', name: 'clip.mp4', mediaType: 'video/mp4', byteLength: 12 }
    });
    session.publishReady({ width: 1920, height: 1080, durationSeconds: 90, frameRate: 30 });
    session.updatePresentation({ currentTimeSeconds: 65.5, volume: 0.5 });
    const markup = renderToStaticMarkup(
      <VideoControlsPanel
        session={session}
        commands={{
          togglePlayback: vi.fn(),
          seek: vi.fn(),
          stepFrame: vi.fn(),
          setMuted: vi.fn(),
          setVolume: vi.fn()
        }}
      />
    );

    expect(markup).toContain('01:05:15');
    expect(markup).toContain('aria-label="Play"');
    expect(markup).toContain('aria-label="Previous frame"');
    expect(markup).toContain('aria-label="Next frame"');
    expect(markup).toContain('aria-label="Video volume"');
    expect(markup).toContain('aria-label="Video time"');
  });
});
