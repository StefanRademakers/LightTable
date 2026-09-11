import { describe, expect, it } from 'vitest';
import { createImageDocument } from '../../../editor/document/documentTypes';
import { findDocumentLayer } from '../../../editor/document/layerTree';
import { fixedTransformDelta, repeatLayerTransform } from './fixedTransformCommands';

describe('fixed transform commands', () => {
  it('builds a fixed transform around the exact content bounds center', () => {
    const delta = fixedTransformDelta('flip-horizontal', { x: 10, y: 20, width: 30, height: 40 });
    expect(delta).toEqual({ a: -1, b: 0, c: 0, d: 1, tx: 50, ty: 0 });
  });

  it('repeats against canonical layer state and duplicates exactly once when requested', () => {
    const document = createImageDocument('repeat', 32, 24, 'repeat-source');
    const delta = { a: 1, b: 0, c: 0, d: 1, tx: 4, ty: -2 };
    const moved = repeatLayerTransform(document, delta, false);
    expect(findDocumentLayer(moved, moved.activeLayerId)?.transform).toMatchObject({ tx: 4, ty: -2 });
    expect(moved.layers).toHaveLength(1);

    const duplicated = repeatLayerTransform(document, delta, true);
    expect(duplicated.layers).toHaveLength(2);
    expect(duplicated.activeLayerId).not.toBe(document.activeLayerId);
    expect(findDocumentLayer(duplicated, duplicated.activeLayerId)?.transform).toMatchObject({ tx: 4, ty: -2 });
  });
});
