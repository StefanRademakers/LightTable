import { describe, expect, it } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createAdjustmentStackFromBasicAdjustments, type AdjustmentStack } from '../../processing/adjustmentStack';
import { createDefaultAdjustments } from '../../types';
import { buildLayeredDocumentFile, parseLayeredDocumentFile } from '../../editor/persistence/layeredDocumentFormat';
import {
  duplicateDocumentDefaultName,
  duplicateLayeredDocumentArtifact,
  duplicateDocumentSemantics,
  normalizeDuplicateDocumentName
} from './duplicateLayeredDocumentArtifact';

describe('duplicate document semantics', () => {
  it('normalizes the optional name deterministically', () => {
    expect(duplicateDocumentDefaultName('portrait.lighttable.png')).toBe('portrait copy');
    expect(normalizeDuplicateDocumentName('  Variant  ', 'portrait.png')).toBe('Variant');
    expect(normalizeDuplicateDocumentName('   ', 'portrait.png')).toBe('portrait copy');
    expect(() => normalizeDuplicateDocumentName('bad\u0000name', 'portrait.png')).toThrow(/control/);
  });

  it('remaps authored runtime identities and every exact internal reference', () => {
    const document = createImageDocument('Source', 320, 200, 'source-image');
    const layer = document.layers[0]!;
    if (layer.type !== 'raster') throw new Error('Expected raster fixture.');
    layer.mask = {
      id: 'mask-source', enabled: true, linked: true,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      density: 1, feather: 0, revision: 0, pixelRevision: 0, dirtyBounds: null
    };
    layer.attachedAdjustments = [{
      id: 'attached-source', name: 'Curves', enabled: true, revision: 0,
      adjustmentKind: 'curves',
      adjustmentStack: {
        id: 'attached-stack', revision: 0,
        modules: [{ id: 'attached-module', type: 'lt.curves', enabled: true, revision: 0, settings: {} }]
      }
    }];
    const stack: AdjustmentStack = {
      id: 'document-stack', revision: 0,
      modules: [{ id: 'document-module', type: 'lt.light', enabled: true, revision: 0, settings: {
        ownerLayerId: layer.id,
        userLabel: layer.id
      } }]
    };

    const result = duplicateDocumentSemantics(document, stack, 'Independent copy');

    expect(result.document.id).not.toBe(document.id);
    expect(result.document.name).toBe('Independent copy');
    expect(result.document.activeLayerId).toBe(result.document.layers[0]!.id);
    expect(result.document.layers[0]!.id).not.toBe(layer.id);
    const duplicateLayer = result.document.layers[0];
    if (duplicateLayer?.type !== 'raster') throw new Error('Expected duplicate raster.');
    expect(duplicateLayer.mask?.id).not.toBe(layer.mask.id);
    expect(duplicateLayer.attachedAdjustments?.[0]?.id).not.toBe('attached-source');
    expect(result.adjustmentStack.id).not.toBe(stack.id);
    expect(result.adjustmentStack.modules[0]?.settings.ownerLayerId).toBe(duplicateLayer.id);
    expect(result.adjustmentStack.modules[0]?.settings.userLabel).toBe(layer.id);
    expect(document.name).toBe('Source');
    expect(document.activeLayerId).toBe(layer.id);
  });

  it('rebuilds a self-contained one-raster native artifact with remapped binary ownership', async () => {
    const document = createImageDocument('Flat source', 16, 9, 'source-image');
    const sourceLayerId = document.layers[0]!.id;
    const stack = createAdjustmentStackFromBasicAdjustments(createDefaultAdjustments());
    const source = buildLayeredDocumentFile(
      new Blob(['preview'], { type: 'image/png' }), document, stack,
      [{ layerId: sourceLayerId, pixels: new Blob(['pixels'], { type: 'image/png' }), mask: null }],
      'flat-source'
    );

    const artifact = await duplicateLayeredDocumentArtifact(source, 'Flat duplicate');
    const parsed = await parseLayeredDocumentFile(artifact);

    expect(parsed?.document.name).toBe('Flat duplicate');
    expect(parsed?.document.id).not.toBe(document.id);
    expect(parsed?.document.layers[0]?.id).not.toBe(sourceLayerId);
    expect(parsed?.assets[0]?.layerId).toBe(parsed?.document.layers[0]?.id);
    expect(await parsed?.assets[0]?.pixels.text()).toBe('pixels');
  });
});
