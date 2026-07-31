import { describe, expect, it } from 'vitest';
import {
  effectiveSelectionMode,
  selectionShapeBuffers
} from './SelectionRasterizer';

describe('selectionShapeBuffers', () => {
  it('packs rectangle bounds into the GPU contract', () => {
    const result = selectionShapeBuffers({
      kind: 'rectangle',
      points: [{ x: 12, y: 18 }, { x: 90, y: 72 }]
    }, 1920, 1080);
    expect(Array.from(result!.points)).toEqual([12, 18, 90, 72]);
    expect(Array.from(result!.settings)).toEqual([
      1920, 1080, 0, 2, 12, 18, 90, 72
    ]);
  });

  it('rejects incomplete polygon paths', () => {
    expect(selectionShapeBuffers({
      kind: 'polygon',
      points: [{ x: 1, y: 2 }, { x: 3, y: 4 }]
    }, 100, 100)).toBeNull();
  });
});

describe('effectiveSelectionMode', () => {
  it('starts a new selection as replace', () => {
    expect(effectiveSelectionMode(false, 'add')).toBe('replace');
  });

  it('does not subtract without an active selection', () => {
    expect(effectiveSelectionMode(false, 'subtract')).toBeNull();
  });

  it('keeps the requested mode for an active selection', () => {
    expect(effectiveSelectionMode(true, 'intersect')).toBe('intersect');
  });
});
