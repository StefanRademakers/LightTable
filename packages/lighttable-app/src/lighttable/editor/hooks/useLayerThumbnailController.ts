import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImageDocument, LayerId } from '../document/documentTypes';
import { walkLayerTree } from '../document/layerTree';
import type {
  LayerThumbnailPreview,
  LayerThumbnailSet
} from '../layers/layerThumbnailTypes';

export interface LayerThumbnailRendererPort {
  exportLayerThumbnail(
    layerId: LayerId,
    mask: boolean
  ): Promise<{ blob: Blob; width: number; height: number } | null>;
}

interface LayerThumbnailChannel {
  identity: string;
  layerId: LayerId;
  mask: boolean;
  revisionKey: string;
}

interface LayerThumbnailCacheEntry extends LayerThumbnailPreview {
  revisionKey: string;
}

interface LayerThumbnailControllerOptions {
  document: ImageDocument | null;
  rendererReadyDocumentId: string | null;
  textPresentationRevision?: number;
  getRenderer: () => LayerThumbnailRendererPort | null;
}

export const collectLayerThumbnailChannels = (
  document: ImageDocument
): LayerThumbnailChannel[] => walkLayerTree(document.layers).flatMap(({ node }) => {
  const channels: LayerThumbnailChannel[] = [];
  if (node.type === 'raster') {
    channels.push({
      identity: `${node.id}:pixels`,
      layerId: node.id,
      mask: false,
      revisionKey: `pixels:${node.pixelRevision}`
    });
  }
  if (node.type === 'text') {
    const revisions = node.text.revisions;
    channels.push({
      identity: `${node.id}:pixels`,
      layerId: node.id,
      mask: false,
      revisionKey: `text:${revisions.content}:${revisions.font}:${revisions.layout}:${revisions.paint}:${revisions.path}:${revisions.geometry}`
    });
  }
  if (node.mask) {
    channels.push({
      identity: `${node.id}:mask`,
      layerId: node.id,
      mask: true,
      revisionKey: `mask:${node.mask.pixelRevision}`
    });
  }
  return channels;
});

/**
 * Captures only document state that can change a layer thumbnail.
 *
 * ImageDocument is immutable, but many editor-only changes publish a new
 * document object without changing raster or mask pixels. Keeping that state
 * out of this key prevents those updates from restarting GPU readback work or
 * publishing an equivalent thumbnail map.
 */
export const layerThumbnailChannelsKey = (
  channels: readonly LayerThumbnailChannel[]
) => JSON.stringify(channels.map(({ identity, revisionKey }) => [identity, revisionKey]));

/**
 * Owns the disposable object-URL cache for one document's accessory layer UI.
 *
 * Thumbnail failures are deliberately isolated from document/render failure:
 * a layer may disappear while an asynchronous GPU readback is in flight.
 */
export const useLayerThumbnailController = ({
  document,
  rendererReadyDocumentId,
  textPresentationRevision = 0,
  getRenderer
}: LayerThumbnailControllerOptions): ReadonlyMap<LayerId, LayerThumbnailSet> => {
  const cacheRef = useRef<Map<string, LayerThumbnailCacheEntry>>(new Map());
  const rendererRef = useRef(getRenderer);
  rendererRef.current = getRenderer;
  const [thumbnails, setThumbnails] = useState<
    ReadonlyMap<LayerId, LayerThumbnailSet>
  >(() => new Map());
  const desiredChannels = useMemo(
    () => document ? collectLayerThumbnailChannels(document) : [],
    [document]
  );
  const desired = useMemo(() => desiredChannels.map((channel) =>
    channel.revisionKey.startsWith('text:')
      ? { ...channel, revisionKey: `${channel.revisionKey}:presentation:${textPresentationRevision}` }
      : channel
  ), [desiredChannels, textPresentationRevision]);
  const desiredKey = layerThumbnailChannelsKey(desired);
  const documentId = document?.id ?? null;

  useEffect(() => {
    const renderer = rendererRef.current();
    if (!documentId || rendererReadyDocumentId !== documentId || !renderer) {
      cacheRef.current.forEach(({ url }) => URL.revokeObjectURL(url));
      cacheRef.current.clear();
      setThumbnails(new Map());
      return;
    }

    let canceled = false;

    void (async () => {
      const committedCache = cacheRef.current;
      const nextCache = new Map<string, LayerThumbnailCacheEntry>();
      const createdUrls: string[] = [];

      for (const channel of desired) {
        const existing = committedCache.get(channel.identity);
        if (existing?.revisionKey === channel.revisionKey) {
          nextCache.set(channel.identity, existing);
          continue;
        }
        try {
          const result = await renderer.exportLayerThumbnail(
            channel.layerId,
            channel.mask
          );
          if (!result) continue;
          const entry: LayerThumbnailCacheEntry = {
            revisionKey: channel.revisionKey,
            url: URL.createObjectURL(result.blob),
            width: result.width,
            height: result.height
          };
          createdUrls.push(entry.url);
          nextCache.set(channel.identity, entry);
        } catch (reason) {
          console.warn('LightTable layer thumbnail generation failed', reason);
        }
        if (canceled) break;
      }

      if (canceled) {
        createdUrls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }

      committedCache.forEach((entry, identity) => {
        if (nextCache.get(identity)?.url !== entry.url) {
          URL.revokeObjectURL(entry.url);
        }
      });
      cacheRef.current = nextCache;

      const nextThumbnails = new Map<LayerId, LayerThumbnailSet>();
      desired.forEach(({ identity, layerId, mask }) => {
        const entry = nextCache.get(identity);
        if (!entry) return;
        const current = nextThumbnails.get(layerId) ?? {};
        nextThumbnails.set(
          layerId,
          mask
            ? { ...current, mask: entry }
            : { ...current, pixels: entry }
        );
      });
      setThumbnails(nextThumbnails);
    })();

    return () => {
      canceled = true;
    };
    // `desiredKey` deliberately represents the pixel-bearing subset of the
    // immutable document. `desired` is the matching snapshot from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desiredKey, documentId, rendererReadyDocumentId, textPresentationRevision]);

  useEffect(() => () => {
    cacheRef.current.forEach(({ url }) => URL.revokeObjectURL(url));
    cacheRef.current.clear();
  }, []);

  return thumbnails;
};
