import type { ImageDocument, LayerId, LayerNode, Rect } from '../../../editor/document/documentTypes';
import { findDocumentLayer } from '../../../editor/document/layerTree';
import type { AffineMatrix } from '../../../editor/tools/transform/transformTypes';
import { identityMatrix, matrixApproximatelyEqual, multiplyMatrices } from '../../../editor/tools/transform/affine';
import { setLayerMaskTransform, setLayerTransform } from '../../../editor/document/documentCommands';
import {
  captureTransformGroupPreviewSources,
  projectTransformGroupPreviews,
  transformLayerGroupInDocumentSpace,
  type TransformGroupPreviewSource
} from '../snapping/groupLayerTransform';

export interface AuxiliaryTransformRenderer {
  updateLayerGeometryPreviews?(
    previews: readonly { readonly layer: LayerNode; readonly matrix: AffineMatrix }[]
  ): boolean;
  clearLayerGeometryPreviews?(layers: readonly LayerNode[]): boolean;
  updateLayerMaskGeometryPreview?(layer: LayerNode, matrix: AffineMatrix): boolean;
  clearLayerMaskGeometryPreview?(layer: LayerNode): boolean;
}

interface SessionBase {
  before: ImageDocument;
  renderer: AuxiliaryTransformRenderer;
  rendererGeneration: number;
  matrix: AffineMatrix;
  bounds: Rect;
}

interface GroupSession extends SessionBase {
  kind: 'group';
  layerIds: readonly LayerId[];
  requestedSelectionKey: string;
  previewSources: readonly TransformGroupPreviewSource[];
}

interface MaskSession extends SessionBase {
  kind: 'mask';
  layerId: LayerId;
  layerTransform: AffineMatrix;
  maskTransform: AffineMatrix;
  linked: boolean;
}

type AuxiliarySession = GroupSession | MaskSession;

export type AuxiliaryTransformTerminalResult =
  | { kind: 'none' }
  | { kind: 'cancelled' }
  | { kind: 'unchanged' }
  | { kind: 'error'; message: string }
  | {
      kind: 'commit';
      target: 'group' | 'mask';
      before: ImageDocument;
      after: ImageDocument;
      layerIds: readonly LayerId[];
    };

/**
 * Owns the complete renderer-bound lifetime of group and layer-mask previews.
 * React may project its matrix, but cannot rediscover a renderer or finalize it.
 */
export class AuxiliaryTransformSessionOwner {
  private session: AuxiliarySession | null = null;

  constructor(private readonly current: () => {
    renderer: AuxiliaryTransformRenderer | null;
    rendererGeneration: number;
  }) {}

  get active() { return this.session !== null; }
  get kind() { return this.session?.kind ?? null; }
  get matrix() { return this.session?.matrix ?? null; }
  get bounds() { return this.session?.bounds ?? null; }
  get layerId() {
    return this.session?.kind === 'mask' ? this.session.layerId : null;
  }
  get requestedSelectionKey() {
    return this.session?.kind === 'group' ? this.session.requestedSelectionKey : null;
  }
  get rendererGeneration() { return this.session?.rendererGeneration ?? null; }

  admitGroup(input: Omit<GroupSession, 'kind' | 'matrix' | 'previewSources'>): void {
    this.assertIdle();
    this.session = {
      ...input,
      kind: 'group',
      matrix: identityMatrix(),
      previewSources: captureTransformGroupPreviewSources(input.before, input.layerIds)
    };
  }

  admitMask(input: Omit<MaskSession, 'kind' | 'matrix'>): void {
    this.assertIdle();
    this.session = { ...input, kind: 'mask', matrix: identityMatrix() };
  }

  update(matrix: AffineMatrix): boolean {
    const session = this.session;
    if (!session || !this.isCurrent(session)) return false;
    if (session.kind === 'group') {
      if (!session.renderer.updateLayerGeometryPreviews?.(
        projectTransformGroupPreviews(session.previewSources, matrix)
      )) return false;
    } else {
      const sourceLayer = findDocumentLayer(session.before, session.layerId);
      if (!sourceLayer) return false;
      const maskTransform = multiplyMatrices(matrix, session.maskTransform);
      if (session.linked) {
        const layerUpdated = session.renderer.updateLayerGeometryPreviews?.([{
          layer: sourceLayer,
          matrix: multiplyMatrices(matrix, session.layerTransform)
        }]) ?? false;
        const maskUpdated = session.renderer.updateLayerMaskGeometryPreview?.(
          sourceLayer, maskTransform
        ) ?? false;
        if (!layerUpdated || !maskUpdated) {
          if (layerUpdated) session.renderer.clearLayerGeometryPreviews?.([sourceLayer]);
          if (maskUpdated) session.renderer.clearLayerMaskGeometryPreview?.(sourceLayer);
          return false;
        }
      } else if (!session.renderer.updateLayerMaskGeometryPreview?.(
        sourceLayer, maskTransform
      )) return false;
    }
    session.matrix = { ...matrix };
    return true;
  }

  finish(commit: boolean, activeDocument: ImageDocument | null): AuxiliaryTransformTerminalResult {
    const session = this.session;
    if (!session) return { kind: 'none' };
    this.session = null;
    const rendererCurrent = this.isCurrent(session);
    if (rendererCurrent) this.clearPreview(session);
    if (!commit || !rendererCurrent || !activeDocument || activeDocument.id !== session.before.id) {
      return { kind: 'cancelled' };
    }
    if (matrixApproximatelyEqual(session.matrix, identityMatrix())) return { kind: 'unchanged' };
    if (activeDocument.revision !== session.before.revision) {
      return {
        kind: 'error',
        message: `The document changed during the ${session.kind} transform; the preview was discarded.`
      };
    }
    const after = session.kind === 'group'
      ? transformLayerGroupInDocumentSpace(session.before, session.layerIds, session.matrix)
      : session.linked
        ? setLayerTransform(
            session.before,
            session.layerId,
            multiplyMatrices(session.matrix, session.layerTransform)
          )
        : setLayerMaskTransform(
            session.before,
            session.layerId,
            multiplyMatrices(session.matrix, session.maskTransform)
          );
    if (after === session.before) return { kind: 'unchanged' };
    return {
      kind: 'commit',
      target: session.kind,
      before: session.before,
      after,
      layerIds: session.kind === 'group' ? session.layerIds : [session.layerId]
    };
  }

  discard(): void {
    const session = this.session;
    this.session = null;
    if (session && this.isCurrent(session)) this.clearPreview(session);
  }

  private isCurrent(session: AuxiliarySession): boolean {
    const current = this.current();
    return current.renderer === session.renderer
      && current.rendererGeneration === session.rendererGeneration;
  }

  private clearPreview(session: AuxiliarySession): void {
    if (session.kind === 'group') {
      session.renderer.clearLayerGeometryPreviews?.(session.layerIds.flatMap((layerId) => {
        const layer = findDocumentLayer(session.before, layerId);
        return layer ? [layer] : [];
      }));
      return;
    }
    const layer = findDocumentLayer(session.before, session.layerId);
    if (!layer) return;
    if (session.linked) session.renderer.clearLayerGeometryPreviews?.([layer]);
    session.renderer.clearLayerMaskGeometryPreview?.(layer);
  }

  private assertIdle(): void {
    if (this.session) throw new Error('An auxiliary transform session is already active.');
  }
}
