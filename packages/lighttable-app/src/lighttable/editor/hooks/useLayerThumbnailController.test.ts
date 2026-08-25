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

  it('uses the semantic text icon instead of scheduling a GPU pixel thumbnail', () => {
    const document = createTextLayer(
      createImageDocument('Text thumbnail', 64, 32, 'source'),
      createDefaultTextLayerData(),
      'Headline'
    );
    const layer = document.layers.at(-1)!;
    expect(collectLayerThumbnailChannels(document)
      .filter(({ layerId }) => layerId === layer.id)).toEqual([]);
  });

  it('does not invalidate accessory thumbnails when only text geometry changes', () => {
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
    )).toBe(initialKey);
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

  it('never projects a stale mask preview for a newer mask pixel revision', () => {
    const rasterDocument = createRasterLayer(
      createImageDocument('Mask thumbnail revision', 64, 32, 'source'),
      'Paint'
    );
    const maskedDocument = addLayerMask(
      rasterDocument,
      rasterDocument.activeLayerId!
    );
    const initialChannels = collectLayerThumbnailChannels(maskedDocument);
    const maskChannel = initialChannels.find(({ mask }) => mask)!;
    const staleCache = new Map([[maskChannel.identity, {
      revisionKey: maskChannel.revisionKey,
      url: 'blob:opaque-mask',
      width: 40,
      height: 20
    }]]);
    const changedDocument = {
      ...maskedDocument,
      layers: maskedDocument.layers.map((layer) => layer.mask
        ? {
            ...layer,
            mask: {
              ...layer.mask,
              pixelRevision: layer.mask.pixelRevision + 1
            }
          }
        : layer)
    };

    const projected = projectLayerThumbnails(
      collectLayerThumbnailChannels(changedDocument),
      staleCache
    );

    expect(projected.get(maskChannel.layerId)?.mask).toBeUndefined();
  });
});
