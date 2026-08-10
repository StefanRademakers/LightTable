import { describe, expect, it } from 'vitest';
import { createRasterLayer } from '../../../editor/document/documentCommands';
import { createImageDocument } from '../../../editor/document/documentTypes';
import { smartSelectionExcludedLayerIds } from './smartSelectionSource';

describe('smartSelectionExcludedLayerIds', () => {
  const createTestDocument = () => createRasterLayer(
    createImageDocument('Smart selection', 32, 24, 'background'),
    'Top'
  );
  it('samples the full visible composite when requested', () => {
    expect(smartSelectionExcludedLayerIds(createTestDocument(), true)).toEqual([]);
  });

  it('excludes every layer except the active layer for current-layer sampling', () => {
    const document = createTestDocument();
    const excluded = smartSelectionExcludedLayerIds(document, false);
    expect(excluded).not.toContain(document.activeLayerId);
    expect(excluded.length).toBe(document.layers.length - 1);
  });
});
