import { describe, expect, it } from 'vitest';
import {
  buildBrushCursorEditingOverlay,
  buildSelectionEditingOverlay,
  directSelectionShape
} from './selectionEditingOverlay';

describe('selection editing overlays', () => {
  it('keeps pasteboard coordinates intact while drafting', () => {
    const overlay = buildSelectionEditingOverlay({
      kind: 'rectangle',
      points: [{ x: -40, y: -20 }, { x: 180, y: 90 }]
    }, 'draft');

    expect(overlay.cubics).toHaveLength(4);
    expect(overlay.cubics[0]?.p0).toEqual({ x: -40, y: -20 });
    expect(overlay.cubics[2]?.p3).toEqual({ x: -40, y: 90 });
  });

  it('uses four continuous cubics for ellipses', () => {
    const overlay = buildSelectionEditingOverlay({
      kind: 'ellipse',
      points: [{ x: 10, y: 20 }, { x: 110, y: 80 }]
    }, 'committed');

    expect(overlay.cubics).toHaveLength(4);
    expect(overlay.cubics[0]?.p0).toEqual({ x: 110, y: 50 });
    expect(overlay.cubics[3]?.p3).toEqual({ x: 110, y: 50 });
  });

  it('keeps a polygon draft open and closes its committed contour', () => {
    const shape = {
      kind: 'polygon' as const,
      points: [{ x: 1, y: 2 }, { x: 8, y: 3 }, { x: 5, y: 9 }]
    };
    expect(buildSelectionEditingOverlay(shape, 'draft').cubics).toHaveLength(2);
    expect(buildSelectionEditingOverlay(shape, 'committed').cubics).toHaveLength(3);
  });

  it('builds a document-space brush circle with the requested diameter', () => {
    const overlay = buildBrushCursorEditingOverlay({ x: 50, y: 70 }, 24);
    expect(overlay.cubics).toHaveLength(4);
    expect(overlay.cubics[0]?.p0).toEqual({ x: 62, y: 70 });
    expect(overlay.cubics[2]?.p0).toEqual({ x: 38, y: 70 });
  });

  it('only exposes a single replace operation as direct geometry', () => {
    const shape = {
      kind: 'rectangle' as const,
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }]
    };
    expect(directSelectionShape([{ mode: 'replace', shape }])).toBe(shape);
    expect(directSelectionShape([{ mode: 'add', shape }])).toBeNull();
  });
});
