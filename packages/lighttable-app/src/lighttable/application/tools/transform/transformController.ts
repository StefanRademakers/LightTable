import {
  markLayerPixelsChanged,
  setLayerTransform
} from '../../../editor/document/documentCommands';
import type {
  ImageDocument,
  RasterLayer,
  Rect
} from '../../../editor/document/documentTypes';
import { findRasterLayer } from '../../../editor/document/layerTree';
import type { ReversiblePixelEdit } from '../../../editor/rendering/LayerDocumentRenderer';
import type { SelectionCoverageBounds } from '../../../editor/selection/selectionCoverage';
import type { SelectionOperation } from '../../../editor/selection/selectionTypes';
import {
  identityMatrix,
  matrixApproximatelyEqual,
  multiplyMatrices,
  transformedBounds
} from '../../../editor/tools/transform/affine';
import { transformSelectionOperations } from '../../../editor/tools/transform/selectionTransform';
import type {
  AffineMatrix,
  TransformSessionState
} from '../../../editor/tools/transform/transformTypes';

export interface TransformRendererPort {
  measureSelectedLayerContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null>;
  measureLayerContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null>;
  beginLayerTransform(layer: RasterLayer, useSelection: boolean): void;
  updateLayerTransform(matrix: AffineMatrix): boolean;
  commitLayerTransform(): ReversiblePixelEdit | null;
  cancelLayerTransform(): boolean | void;
}

export type BeginTransformResult =
  | {
    readonly ok: true;
    readonly state: TransformSessionState;
    readonly notice: string | null;
  }
  | {
    readonly ok: false;
    readonly code: 'already-active' | 'invalid-target' | 'empty-layer' | 'preview-unavailable' | 'stale' | 'renderer-error';
    readonly message: string | null;
  };

export type FinishTransformResult =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'unchanged' }
  | {
    readonly kind: 'layer';
    readonly beforeDocument: ImageDocument;
    readonly afterDocument: ImageDocument;
    readonly layerId: RasterLayer['id'];
  }
  | {
    readonly kind: 'selection';
    readonly beforeDocument: ImageDocument;
    readonly afterDocument: ImageDocument;
    readonly beforeSelection: SelectionOperation[];
    readonly afterSelection: SelectionOperation[];
    readonly layerId: RasterLayer['id'];
    readonly pixelEdit: ReversiblePixelEdit;
  }
  | {
    readonly kind: 'error';
    readonly message: string;
  };

const cloneSelection = (selection: SelectionOperation[]): SelectionOperation[] =>
  selection.map((operation) => ({
    ...operation,
    shape: {
      ...operation.shape,
      points: operation.shape.points.map((point) => ({ ...point }))
    }
  }));

const mergeBounds = (first: Rect, second: Rect): Rect => {
  const left = Math.min(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/**
 * Owns the renderer-backed lifecycle of one non-destructive layer or selected
 * pixel transform.
 *
 * React is deliberately not part of this controller. The caller publishes the
 * returned state to the gizmo and records the typed finish result in the
 * document-scoped history.
 */
export class TransformController {
  private activeState: TransformSessionState | null = null;
  private launchRevision = 0;

  constructor(private readonly renderer: TransformRendererPort) {}

  get state(): TransformSessionState | null {
    return this.activeState ? {
      ...this.activeState,
      sourceBounds: { ...this.activeState.sourceBounds },
      supportBounds: { ...this.activeState.supportBounds },
      sourceMatrix: { ...this.activeState.sourceMatrix },
      matrix: { ...this.activeState.matrix }
    } : null;
  }

  invalidatePendingLaunch(): void {
    this.launchRevision += 1;
  }

  async begin(
    document: ImageDocument,
    selection: SelectionOperation[]
  ): Promise<BeginTransformResult> {
    if (this.activeState) {
      return {
        ok: false,
        code: 'already-active',
        message: null
      };
    }
    const launchRevision = ++this.launchRevision;
    const layer = findRasterLayer(document, document.activeLayerId);
    if (!layer) {
      return {
        ok: false,
        code: 'invalid-target',
        message: 'Select a raster layer before transforming.'
      };
    }

    const selectionRequested = selection.length > 0;
    let usesSelection = selectionRequested
      && matrixApproximatelyEqual(layer.transform, identityMatrix());
    let sourceMatrix = usesSelection ? identityMatrix() : layer.transform;

    try {
      let measuredContent = usesSelection
        ? await this.renderer.measureSelectedLayerContent(layer)
        : await this.renderer.measureLayerContent(layer);
      if (launchRevision !== this.launchRevision || this.activeState) {
        return { ok: false, code: 'stale', message: null };
      }
      if (!measuredContent && usesSelection) {
        usesSelection = false;
        sourceMatrix = layer.transform;
        measuredContent = await this.renderer.measureLayerContent(layer);
        if (launchRevision !== this.launchRevision || this.activeState) {
          return { ok: false, code: 'stale', message: null };
        }
      }
      if (!measuredContent) {
        return {
          ok: false,
          code: 'empty-layer',
          message: 'The active layer does not contain visible pixels.'
        };
      }

      const state: TransformSessionState = {
        layerId: layer.id,
        sourceBounds: usesSelection
          ? measuredContent.coreBounds
          : transformedBounds(sourceMatrix, measuredContent.coreBounds),
        supportBounds: usesSelection
          ? measuredContent.supportBounds
          : transformedBounds(sourceMatrix, measuredContent.supportBounds),
        sourceMatrix: { ...sourceMatrix },
        matrix: identityMatrix(),
        sourceKind: usesSelection ? 'selection' : 'layer'
      };
      this.renderer.beginLayerTransform(layer, usesSelection);
      if (!this.renderer.updateLayerTransform(
        multiplyMatrices(state.matrix, state.sourceMatrix)
      )) {
        this.renderer.cancelLayerTransform();
        return {
          ok: false,
          code: 'preview-unavailable',
          message: 'The transform preview could not be started.'
        };
      }
      this.activeState = state;
      return {
        ok: true,
        state: this.state!,
        notice: selectionRequested && !usesSelection
          ? (
              matrixApproximatelyEqual(layer.transform, identityMatrix())
                ? 'The selection contains no visible pixels; transforming the active layer'
                : 'Transforming the active layer; rasterize it first to transform selected pixels'
            )
          : null
      };
    } catch (reason) {
      this.renderer.cancelLayerTransform();
      return {
        ok: false,
        code: 'renderer-error',
        message: reason instanceof Error
          ? reason.message
          : 'The transform could not be started.'
      };
    }
  }

  update(matrix: AffineMatrix): TransformSessionState | null {
    if (
      !this.activeState
      || !this.renderer.updateLayerTransform(
        multiplyMatrices(matrix, this.activeState.sourceMatrix)
      )
    ) return null;
    this.activeState = { ...this.activeState, matrix: { ...matrix } };
    return this.state;
  }

  finish(
    document: ImageDocument | null,
    selection: SelectionOperation[],
    commit: boolean
  ): FinishTransformResult {
    const state = this.activeState;
    this.launchRevision += 1;
    this.activeState = null;
    if (!state) return { kind: 'unchanged' };
    if (
      !commit
      || !document
      || matrixApproximatelyEqual(state.matrix, identityMatrix())
    ) {
      this.renderer.cancelLayerTransform();
      return { kind: commit ? 'unchanged' : 'cancelled' };
    }

    if (state.sourceKind === 'layer') {
      this.renderer.cancelLayerTransform();
      return {
        kind: 'layer',
        beforeDocument: document,
        afterDocument: setLayerTransform(
          document,
          state.layerId,
          multiplyMatrices(state.matrix, state.sourceMatrix)
        ),
        layerId: state.layerId
      };
    }

    const pixelEdit = this.renderer.commitLayerTransform();
    if (!pixelEdit) {
      this.renderer.cancelLayerTransform();
      return {
        kind: 'error',
        message: 'The transform could not be committed.'
      };
    }
    const dirtyBounds = mergeBounds(
      state.supportBounds,
      transformedBounds(state.matrix, state.supportBounds)
    );
    const beforeSelection = cloneSelection(selection);
    return {
      kind: 'selection',
      beforeDocument: document,
      afterDocument: markLayerPixelsChanged(document, state.layerId, dirtyBounds),
      beforeSelection,
      afterSelection: transformSelectionOperations(beforeSelection, state.matrix),
      layerId: state.layerId,
      pixelEdit
    };
  }
}
