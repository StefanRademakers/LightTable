import type { LayerId, VectorLayer } from '../document/documentTypes';

interface VectorContentPreview {
  readonly layer: VectorLayer;
  readonly sourceRevision: number;
}

/**
 * Holds renderer-only vector content during pointer-hot element gestures.
 *
 * The canonical document remains unchanged until the gesture commits. A
 * preview is rejected as soon as its source layer changes, so stale pointer
 * work cannot outlive an undo, command, document switch or remote edit.
 */
export class VectorContentPreviewStore {
  private readonly previews = new Map<LayerId, VectorContentPreview>();

  replace(layers: readonly VectorLayer[]) {
    const nextIds = new Set(layers.map(({ id }) => id));
    let changed = false;
    for (const layerId of this.previews.keys()) {
      if (nextIds.has(layerId)) continue;
      this.previews.delete(layerId);
      changed = true;
    }
    for (const layer of layers) {
      this.previews.set(layer.id, {
        layer,
        sourceRevision: layer.revision
      });
      changed = true;
    }
    return changed;
  }

  resolve(layer: VectorLayer) {
    const preview = this.previews.get(layer.id);
    if (!preview) return null;
    if (preview.sourceRevision !== layer.revision) {
      this.previews.delete(layer.id);
      return null;
    }
    return preview.layer;
  }

  clear() {
    const changed = this.previews.size > 0;
    this.previews.clear();
    return changed;
  }
}
