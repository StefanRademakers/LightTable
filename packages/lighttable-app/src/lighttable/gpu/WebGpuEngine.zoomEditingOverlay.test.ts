import { describe, expect, it, vi } from 'vitest';
import { WebGpuEngine } from './WebGpuEngine';

describe('WebGpuEngine zoom editing overlay presentation', () => {
  it('keeps the drag rectangle in the viewport-only GPU overlay path', () => {
    const invalidate = vi.fn();
    const requestRender = vi.fn();
    const engine = {
      zoomOverlayDraft: null,
      renderDirty: { invalidate },
      requestRender
    } as unknown as WebGpuEngine;
    const setOverlay = WebGpuEngine.prototype.setZoomEditingOverlay.bind(engine);
    const draft = {
      kind: 'rectangle' as const,
      points: [{ x: 10, y: 20 }, { x: 80, y: 60 }]
    };

    setOverlay(draft);
    setOverlay(draft);
    setOverlay({ ...draft, points: [draft.points[0]!, { x: 90, y: 60 }] });
    setOverlay(null);

    expect(invalidate.mock.calls).toEqual([
      ['viewport'], ['viewport'], ['viewport']
    ]);
    expect(requestRender).toHaveBeenCalledTimes(3);
  });
});
