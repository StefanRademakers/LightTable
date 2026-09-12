import type { ImageDocument, LayerId } from '../../editor/document/documentTypes';

/** Return the ID from the admitted immutable result, never from later active-layer presentation. */
export const applyLayerCreation = (
  mutate: (change: (document: ImageDocument) => ImageDocument) => boolean,
  create: (document: ImageDocument) => ImageDocument
): LayerId | null => {
  let layerId: LayerId | null = null;
  const applied = mutate(document => {
    const next = create(document);
    if (next !== document) layerId = next.activeLayerId;
    return next;
  });
  return applied ? layerId : null;
};
