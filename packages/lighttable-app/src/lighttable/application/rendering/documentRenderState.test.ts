import { describe, expect, it } from 'vitest';
import {
  renameLayer,
  setLayerLocked,
  setLayerOpacity,
  setLayerVisibility
} from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { documentRenderStatesEqual } from './documentRenderState';

describe('document render state', () => {
  it('accepts repeated publications of the same immutable document', () => {
    const document = createImageDocument('Image', 64, 32, 'asset');
    expect(documentRenderStatesEqual(document, document)).toBe(true);
  });

  it('never reuses render state across documents', () => {
    const current = createImageDocument('Image', 64, 32, 'asset');
    const next = createImageDocument('Image', 64, 32, 'asset');
    expect(documentRenderStatesEqual(current, next)).toBe(false);
  });

  it('ignores layer names and editor locks', () => {
    const document = createImageDocument('Image', 64, 32, 'asset');
    const layerId = document.layers[0].id;
    const renamed = renameLayer(document, layerId, 'Plate');
    const locked = setLayerLocked(renamed, layerId, true);

    expect(renamed.revision).toBeGreaterThan(document.revision);
    expect(locked.revision).toBeGreaterThan(renamed.revision);
    expect(documentRenderStatesEqual(document, renamed)).toBe(true);
    expect(documentRenderStatesEqual(renamed, locked)).toBe(true);
  });

  it('detects compositing changes', () => {
    const document = createImageDocument('Image', 64, 32, 'asset');
    const layerId = document.layers[0].id;

    expect(documentRenderStatesEqual(
      document,
      setLayerOpacity(document, layerId, 0.5)
    )).toBe(false);
    expect(documentRenderStatesEqual(
      document,
      setLayerVisibility(document, layerId, false)
    )).toBe(false);
  });

  it('detects raster pixel changes without depending on generic revisions', () => {
    const document = createImageDocument('Image', 64, 32, 'asset');
    const raster = document.layers[0];
    if (raster.type !== 'raster') throw new Error('Expected raster fixture.');
    const changed = {
      ...document,
      revision: document.revision + 1,
      layers: [{ ...raster, pixelRevision: raster.pixelRevision + 1 }]
    };

    expect(documentRenderStatesEqual(document, changed)).toBe(false);
  });
});
