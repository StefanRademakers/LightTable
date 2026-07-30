import { describe, expect, it } from 'vitest';
import { addLayerMask, createRasterLayer } from '../document/documentCommands';
import { createImageDocument } from '../document/documentTypes';
import { collectLayerThumbnailChannels } from './useLayerThumbnailController';

describe('collectLayerThumbnailChannels', () => {
  it('tracks raster pixels and masks by their independent revisions', () => {
    const rasterDocument = createRasterLayer(
      createImageDocument('Thumbnail test', 64, 32, 'source'),
      'Paint'
    );
    const maskedDocument = addLayerMask(
      rasterDocument,
      rasterDocument.activeLayerId!
    );
    const activeLayerId = maskedDocument.activeLayerId!;

    expect(collectLayerThumbnailChannels(maskedDocument)).toEqual(
      expect.arrayContaining([
        {
          identity: `${activeLayerId}:pixels`,
          layerId: activeLayerId,
          mask: false,
          revisionKey: 'pixels:0'
        },
        {
          identity: `${activeLayerId}:mask`,
          layerId: activeLayerId,
          mask: true,
          revisionKey: 'mask:0'
        }
      ])
    );
  });
});
