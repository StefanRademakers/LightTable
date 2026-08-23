import { describe, expect, it } from 'vitest';
import { DocumentStartupTimeline } from './documentStartupTimeline';

describe('DocumentStartupTimeline', () => {
  it('records monotonic first occurrences without publishing mutable state', () => {
    let now = 100;
    const timeline = new DocumentStartupTimeline(() => now);
    now = 112;
    timeline.mark('bytes-available', { byteLength: 42 });
    now = 130;
    timeline.mark('bytes-available', { byteLength: 999 });
    now = 580;
    timeline.mark('first-pixel-visible');

    expect(timeline.snapshot()).toEqual({
      targetMs: 500,
      complete: true,
      firstPixelVisibleMs: 480,
      targetMet: true,
      events: [
        { stage: 'file-selected', elapsedMs: 0 },
        { stage: 'bytes-available', elapsedMs: 12, detail: { byteLength: 42 } },
        { stage: 'first-pixel-visible', elapsedMs: 480 }
      ]
    });
  });
});
