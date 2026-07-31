import type { LayerId } from '../document/documentTypes';
import type { AffineMatrix } from '../tools/transform/transformTypes';

interface GeometryPreview {
  matrix: AffineMatrix;
  sourceGeometryRevision: number;
}

/**
 * Holds non-canonical geometry previews and rejects them as soon as the source
 * layer revision changes. Preview state never survives document teardown.
 */
export class GeometryPreviewStore {
  private readonly previews = new Map<LayerId, GeometryPreview>();

  set(layerId: LayerId, sourceGeometryRevision: number, matrix: AffineMatrix | null) {
    if (!matrix) return this.previews.delete(layerId);
    this.previews.set(layerId, {
      matrix: { ...matrix },
      sourceGeometryRevision
    });
    return true;
  }

  resolve(layerId: LayerId, sourceGeometryRevision: number) {
    const preview = this.previews.get(layerId);
    if (!preview) return null;
    if (preview.sourceGeometryRevision !== sourceGeometryRevision) {
      this.previews.delete(layerId);
      return null;
    }
    return preview.matrix;
  }

  clear() {
    const changed = this.previews.size > 0;
    this.previews.clear();
    return changed;
  }
}
