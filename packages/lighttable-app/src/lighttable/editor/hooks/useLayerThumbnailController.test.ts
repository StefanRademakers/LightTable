import { describe, expect, it } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { addLayerMask, createRasterLayer, createTextLayer } from '../document/documentCommands';
import { createImageDocument } from '../document/documentTypes';
import {
  collectLayerThumbnailChannels,
  layerThumbnailChannelsKey
} from './useLayerThumbnailController';

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

  it('ignores editor-only and non-pixel document changes', () => {
    const document = createRasterLayer(
      createImageDocument('Thumbnail test', 64, 32, 'source'),
      'Paint'
    );
    const channels = collectLayerThumbnailChannels(document);
    const changedPresentation = {
      ...document,
      activeLayerId: document.layers[0]?.id ?? null,
      revision: document.revision + 1,
      layers: document.layers.map((layer) => ({
        ...layer,
        opacity: 0.5
      }))
    };

    expect(layerThumbnailChannelsKey(
      collectLayerThumbnailChannels(changedPresentation)
    )).toBe(layerThumbnailChannelsKey(channels));
  });

  it('changes when raster or mask pixels change', () => {
    const rasterDocument = createRasterLayer(
      createImageDocument('Thumbnail test', 64, 32, 'source'),
      'Paint'
    );
    const maskedDocument = addLayerMask(
      rasterDocument,
      rasterDocument.activeLayerId!
    );
    const initialKey = layerThumbnailChannelsKey(
      collectLayerThumbnailChannels(maskedDocument)
    );
    const changedPixels = {
      ...maskedDocument,
      layers: maskedDocument.layers.map((layer) => layer.type === 'raster'
        ? {
            ...layer,
            pixelRevision: layer.pixelRevision + 1,
            mask: layer.mask
              ? { ...layer.mask, pixelRevision: layer.mask.pixelRevision + 1 }
              : null
          }
        : layer)
    };

    expect(layerThumbnailChannelsKey(
      collectLayerThumbnailChannels(changedPixels)
    )).not.toBe(initialKey);
  });

  it('tracks canonical text source revisions as a pixel thumbnail channel', () => {
    const document = createTextLayer(
      createImageDocument('Text thumbnail', 64, 32, 'source'),
      createDefaultTextLayerData(),
      'Headline'
    );
    const layer = document.layers.at(-1)!;
    expect(collectLayerThumbnailChannels(document)).toContainEqual({
      identity: `${layer.id}:pixels`,
      layerId: layer.id,
      mask: false,
      revisionKey: 'text:0:0:0:0:0:0'
    });
  });
});
