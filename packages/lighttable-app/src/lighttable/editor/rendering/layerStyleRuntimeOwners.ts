import type { ImageDocument, LayerId } from '../document/documentTypes';
import { layerSupportsLayerStyles } from '../document/documentTypes';
import { walkLayerTree } from '../document/layerTree';

/** Canonical layers whose current presentation can own derived style textures. */
export const activeLayerStyleRuntimeOwners = (document: ImageDocument): ReadonlySet<LayerId> =>
  new Set(walkLayerTree(document.layers)
    .map(({ node }) => node)
    .filter((node) => layerSupportsLayerStyles(node)
      && node.styleStack.enabled
      && node.styleStack.effects.some(({ enabled }) => enabled))
    .map(({ id }) => id));
