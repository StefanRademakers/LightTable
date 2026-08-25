import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIDEO_PRESENTATION,
  normalizeVideoMetadata,
  normalizeVideoPresentation
} from './videoDocument';
import { VideoDocumentSession } from './videoDocumentSession';
import { isSupportedVideoDocument, videoMediaTypeForName } from './videoFormats';

describe('video document core', () => {
  it('keeps playback and viewport state bounded without treating it as an edit', () => {
    expect(normalizeVideoPresentation({
      ...DEFAULT_VIDEO_PRESENTATION,
      currentTimeSeconds: 30,
      volume: 4,
      playbackRate: 0,
      zoom: Number.NaN
    }, 12)).toEqual({
      ...DEFAULT_VIDEO_PRESENTATION,
      currentTimeSeconds: 12,
      volume: 1,
      playbackRate: 0.1
    });
  });

  it('normalizes host metadata before publishing it to the workspace', () => {
    expect(normalizeVideoMetadata({
      width: 1919.6,
      height: 1079.6,
      durationSeconds: Number.NaN,
      frameRate: -1
    })).toEqual({ width: 1920, height: 1080, durationSeconds: 0, frameRate: 0 });
  });

  it('retains playback state without making the video document dirty', () => {
    const session = new VideoDocumentSession({
      id: 'video-1' as never,
      source: { id: 'asset-1', name: 'clip.mp4', mediaType: 'video/mp4', byteLength: 42 }
    });
    let notifications = 0;
    session.subscribe(() => { notifications += 1; });
    session.publishReady({ width: 1920, height: 1080, durationSeconds: 10 });
    session.updatePresentation({ currentTimeSeconds: 4, paused: false });

    expect(session.getSnapshot()).toMatchObject({
      kind: 'video', lifecycle: 'ready', dirty: false,
      presentation: { currentTimeSeconds: 4, paused: false }
    });
    expect(notifications).toBe(2);
  });

  it('pauses and releases observers when disposed', () => {
    const session = new VideoDocumentSession({
      id: 'video-1' as never,
      source: { id: 'asset-1', name: 'clip.webm', mediaType: 'video/webm', byteLength: 42 },
      presentation: { paused: false }
    });
    let notifications = 0;
    session.subscribe(() => { notifications += 1; });
    session.dispose();
    session.updatePresentation({ currentTimeSeconds: 8 });

    expect(session.getSnapshot().lifecycle).toBe('disposed');
    expect(session.getSnapshot().presentation.paused).toBe(true);
    expect(notifications).toBe(1);
  });

  it('classifies admitted dropped/opened video files without accepting arbitrary video types', () => {
    expect(isSupportedVideoDocument({ name: 'render.MP4' })).toBe(true);
    expect(isSupportedVideoDocument({ name: 'render', mediaType: 'video/webm' })).toBe(true);
    expect(isSupportedVideoDocument({ name: 'render.mov', mediaType: 'video/quicktime' })).toBe(false);
    expect(videoMediaTypeForName('render.webm')).toBe('video/webm');
  });
});
