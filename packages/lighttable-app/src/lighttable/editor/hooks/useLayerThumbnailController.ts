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

const THUMBNAIL_PUBLICATION_BATCH_SIZE = 8;

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
    const transform = node.transform;
    channels.push({
      identity: `${node.id}:pixels`,
      layerId: node.id,
      mask: false,
      revisionKey: `text:${revisions.content}:${revisions.font}:${revisions.layout}:${revisions.paint}:${revisions.path}:${revisions.geometry}:geometry:${node.geometryRevision}:transform:${transform.a}:${transform.b}:${transform.c}:${transform.d}:${transform.tx}:${transform.ty}`
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

export const projectLayerThumbnails = (
  desired: readonly LayerThumbnailChannel[],
  cache: ReadonlyMap<string, LayerThumbnailCacheEntry>
): ReadonlyMap<LayerId, LayerThumbnailSet> => {
  const projected = new Map<LayerId, LayerThumbnailSet>();
  desired.forEach(({ identity, layerId, mask }) => {
    const entry = cache.get(identity);
    if (!entry) return;
    const current = projected.get(layerId) ?? {};
    projected.set(
      layerId,
      mask
        ? { ...current, mask: entry }
        : { ...current, pixels: entry }
    );
  });
  return projected;
};

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
      const desiredIdentities = new Set(desired.map(({ identity }) => identity));
      cacheRef.current.forEach((entry, identity) => {
        if (desiredIdentities.has(identity)) return;
        URL.revokeObjectURL(entry.url);
        cacheRef.current.delete(identity);
      });
      setThumbnails(projectLayerThumbnails(desired, cacheRef.current));
      let unpublished = 0;

      for (let index = 0; index < desired.length; index += 1) {
        const channel = desired[index];
        const existing = cacheRef.current.get(channel.identity);
        if (existing?.revisionKey === channel.revisionKey) {
          continue;
        }
        try {
          const result = await renderer.exportLayerThumbnail(
            channel.layerId,
            channel.mask
          );
          if (!result) continue;
          if (canceled) break;
          const entry: LayerThumbnailCacheEntry = {
            revisionKey: channel.revisionKey,
            url: URL.createObjectURL(result.blob),
            width: result.width,
            height: result.height
          };
          cacheRef.current.set(channel.identity, entry);
          if (existing && existing.url !== entry.url) URL.revokeObjectURL(existing.url);
          unpublished += 1;
        } catch (reason) {
          console.warn('LightTable layer thumbnail generation failed', reason);
        }
        if (canceled) break;
        const finalChannel = index === desired.length - 1;
        if (unpublished >= THUMBNAIL_PUBLICATION_BATCH_SIZE || finalChannel) {
          setThumbnails(projectLayerThumbnails(desired, cacheRef.current));
          unpublished = 0;
          if (!finalChannel) {
            await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          }
        }
      }
      if (!canceled && unpublished > 0) {
        setThumbnails(projectLayerThumbnails(desired, cacheRef.current));
      }
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
