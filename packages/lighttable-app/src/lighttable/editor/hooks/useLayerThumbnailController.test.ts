import { describe, expect, it } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { addLayerMask, createRasterLayer, createTextLayer } from '../document/documentCommands';
import { createImageDocument } from '../document/documentTypes';
import {
  collectLayerThumbnailChannels,
  layerThumbnailChannelsKey,
  projectLayerThumbnails
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
      revisionKey: 'text:0:0:0:0:0:0:geometry:0:transform:1:0:0:1:0:0'
    });
  });

  it('invalidates text thumbnails when the common layer transform changes', () => {
    const document = createTextLayer(
      createImageDocument('Text thumbnail', 64, 32, 'source'),
      createDefaultTextLayerData(),
      'Headline'
    );
    const initialKey = layerThumbnailChannelsKey(collectLayerThumbnailChannels(document));
    const transformed = {
      ...document,
      layers: document.layers.map((layer) => layer.type === 'text'
        ? { ...layer, transform: { a: 0, b: 1, c: -1, d: 0, tx: 64, ty: 0 } }
        : layer)
    };

    expect(layerThumbnailChannelsKey(
      collectLayerThumbnailChannels(transformed)
    )).not.toBe(initialKey);
  });

  it('projects progressive cache batches without changing source aspect metadata', () => {
    const document = createRasterLayer(
      createImageDocument('Thumbnail projection', 64, 32, 'source'),
      'Paint'
    );
    const channels = collectLayerThumbnailChannels(document);
    const channel = channels.find(({ layerId }) => layerId === document.activeLayerId)!;
    const cache = new Map([[channel.identity, {
      revisionKey: channel.revisionKey,
      url: 'blob:thumbnail',
      width: 40,
      height: 20
    }]]);

    expect(projectLayerThumbnails(channels, cache).get(channel.layerId)?.pixels).toEqual({
      revisionKey: channel.revisionKey,
      url: 'blob:thumbnail',
      width: 40,
      height: 20
    });
  });
});
