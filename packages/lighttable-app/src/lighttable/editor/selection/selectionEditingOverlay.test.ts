import { describe, expect, it } from 'vitest';
import {
  buildBrushCursorEditingOverlay,
  buildSampledBrushSourceEditingOverlay,
  buildSelectionEditingOverlay,
  directSelectionShape,
  selectionEditingOverlayIsVisible
} from './selectionEditingOverlay';

describe('selection editing overlays', () => {
  it('uses View Extras rather than the active pointer tool as its visibility owner', () => {
    expect(selectionEditingOverlayIsVisible(undefined)).toBe(true);
    expect(selectionEditingOverlayIsVisible(true)).toBe(true);
    expect(selectionEditingOverlayIsVisible(false)).toBe(false);
  });
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
    const overlay = buildBrushCursorEditingOverlay({ x: 50, y: 70 }, 24, 1);
    expect(overlay.cubics).toHaveLength(4);
    expect(overlay.cubics[0]?.p0).toEqual({ x: 62, y: 70 });
    expect(overlay.cubics[2]?.p0).toEqual({ x: 38, y: 70 });
  });

  it('shows hardness as a concentric brush-core ring', () => {
    const medium = buildBrushCursorEditingOverlay({ x: 50, y: 70 }, 24, 0.5);
    expect(medium.cubics).toHaveLength(8);
    expect(medium.cubics[4]?.p0.x).toBeCloseTo(57.2);
    expect(medium.cubics[4]?.p0.y).toBe(70);

    const soft = buildBrushCursorEditingOverlay({ x: 50, y: 70 }, 24, 0);
    expect(soft.cubics[4]?.p0.x).toBeCloseTo(52.4);
    expect(soft.cubics[4]?.p0.y).toBe(70);
  });

  it('builds the sampled source marker in the shared GPU vector overlay', () => {
    const overlay = buildSampledBrushSourceEditingOverlay({ x: 50, y: 70 }, 24, 10);
    expect(overlay.cubics).toHaveLength(6);
    expect(overlay.cubics[0]?.p0).toEqual({ x: 62, y: 70 });
    expect(overlay.cubics[4]?.p0).toEqual({ x: 45, y: 70 });
    expect(overlay.cubics[5]?.p3).toEqual({ x: 50, y: 75 });
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
