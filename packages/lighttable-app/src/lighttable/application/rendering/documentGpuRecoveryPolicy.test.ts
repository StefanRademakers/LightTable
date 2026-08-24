import { describe, expect, it } from 'vitest';
import {
  createGroupLayer,
  createImageDocument,
  createVectorLayer
} from '../../editor/document/documentTypes';
import { resolveDocumentGpuRecoveryPolicy } from './documentGpuRecoveryPolicy';

describe('document GPU recovery policy', () => {
  it('allows canonical semantic documents to rebuild automatically', () => {
    const document = createImageDocument('vectors.svg', 256, 256, 'unused');
    document.layers = [createVectorLayer([], 'Artwork')];

    expect(resolveDocumentGpuRecoveryPolicy(document)).toEqual({ mode: 'automatic' });
  });

  it('requires durable recovery for nested raster pixels and masks', () => {
    const document = createImageDocument('photo.lt', 256, 256, 'source');
    const raster = document.layers[0]!;
    raster.mask = {
      id: 'mask-1', enabled: true, linked: true,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      density: 1, feather: 0, revision: 0, pixelRevision: 0, dirtyBounds: null
    };
    const group = createGroupLayer('Nested');
    group.children = [raster];
    document.layers = [group];

    expect(resolveDocumentGpuRecoveryPolicy(document)).toEqual({
      mode: 'checkpoint-required',
      reasons: ['raster pixels', 'raster masks']
    });
  });

  it('does not rebuild documents whose external binary assets were device-owned', () => {
    const document = createImageDocument('assets.lt', 256, 256, 'unused');
    document.layers = [createVectorLayer([], 'Artwork')];
    document.assets.patterns.push({
      id: 'pattern-1' as never, name: 'Pattern', width: 4, height: 4, revision: 0
    });
    document.assets.colorLookups.push({
      id: 'lut-1' as never,
      name: 'Look',
      size: 2,
      domainMin: [0, 0, 0],
      domainMax: [1, 1, 1],
      byteLength: 96,
      revision: 0
    });

    expect(resolveDocumentGpuRecoveryPolicy(document)).toEqual({
      mode: 'checkpoint-required',
      reasons: ['pattern pixels', 'color lookup data']
    });
  });
});
