import { describe, expect, it } from 'vitest';
import { createImageDocument } from '../editor/document/documentTypes';
import type { SelectionOperation } from '../editor/selection/selectionTypes';
import { DocumentEditingOverlayState } from './DocumentEditingOverlayState';

const rectangle = (x = 1): SelectionOperation => ({
  mode: 'replace',
  shape: {
    kind: 'rectangle',
    points: [{ x, y: 2 }, { x: x + 10, y: 12 }]
  }
});

describe('DocumentEditingOverlayState', () => {
  it('owns cloned semantic overlay geometry without copying raster-mask bytes', () => {
    const state = new DocumentEditingOverlayState();
    const data = new Uint8Array([0, 255]);
    const operation: SelectionOperation = {
      ...rectangle(),
      source: { kind: 'raster-mask', mask: { width: 2, height: 1, data }, documentRevision: 0 }
    };

    state.setCommittedSelection([operation]);
    operation.shape.points[0]!.x = 99;

    expect(state.selectionOperations[0]!.shape.points[0]!.x).toBe(1);
    expect(state.selectionOperations[0]!.source?.kind).toBe('raster-mask');
    if (state.selectionOperations[0]!.source?.kind !== 'raster-mask') throw new Error('mask missing');
    expect(state.selectionOperations[0]!.source.mask.data).toBe(data);
  });

  it('keeps preview translation separate and restores committed projection state', () => {
    const state = new DocumentEditingOverlayState();
    state.setSelection([rectangle()], null, true);
    state.setSelectionPreview([rectangle(5)], { x: 8, y: -4 });
    expect(state.selectionPreviewProjectionActive).toBe(true);
    expect(state.selectionPreviewTranslation).toEqual({ x: 8, y: -4 });

    state.setCommittedSelection([rectangle(7)]);
    expect(state.selectionPreviewProjectionActive).toBe(false);
    expect(state.selectionPreviewTranslation).toEqual({ x: 0, y: 0 });
    expect(state.selectionAntsVisible).toBe(true);
  });

  it('clears every document-bound projection and scene cache', () => {
    const state = new DocumentEditingOverlayState();
    const document = createImageDocument('overlay', 32, 24, 'source');
    state.setSelection([rectangle()], rectangle().shape, true, { visible: true, color: '#ff0080' });
    state.setZoomDraft(rectangle().shape);
    state.setBrushCursor({ center: { x: 3, y: 4 }, diameter: 12 });
    state.resolveVectorScene(document);

    state.clear();

    expect(state.selectionOperations).toEqual([]);
    expect(state.selectionDraft).toBeNull();
    expect(state.zoomDraft).toBeNull();
    expect(state.brushCursor).toBeNull();
    expect(state.selectionAntsVisible).toBe(false);
  });
});
