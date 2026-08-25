import { describe, expect, it } from 'vitest';
import { centerClipboardBounds, visibleDocumentBounds } from './pastePlacement';

describe('clipboard paste placement', () => {
  it('centers natural-size pixels without fitting or clipping them', () => {
    expect(centerClipboardBounds(
      { width: 800, height: 600 },
      { x: 200, y: 300, width: 100, height: 100 }
    )).toEqual({ x: -150, y: 50, width: 800, height: 600 });
  });

  it('projects only the visible viewport area into document coordinates', () => {
    expect(visibleDocumentBounds(
      { width: 1000, height: 800 },
      { width: 400, height: 300 },
      { x: -100, y: -50, width: 500, height: 400 }
    )).toEqual({ x: 200, y: 100, width: 800, height: 600 });
  });

  it('falls back to the document when it is outside the viewport', () => {
    expect(visibleDocumentBounds(
      { width: 640, height: 480 },
      { width: 300, height: 200 },
      { x: 400, y: 300, width: 640, height: 480 }
    )).toEqual({ x: 0, y: 0, width: 640, height: 480 });
  });
});
