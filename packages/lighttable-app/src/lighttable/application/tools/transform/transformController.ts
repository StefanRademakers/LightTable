import {
  markLayerPixelsChanged,
  setLayerTransform
} from '../../../editor/document/documentCommands';
import type {
  ImageDocument,
  LayerId,
  LayerNode,
  RasterLayer,
  Rect
} from '../../../editor/document/documentTypes';
import { findDocumentLayer } from '../../../editor/document/layerTree';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import type { SelectionCoverageBounds } from '../../../editor/selection/selectionCoverage';
import {
  createTranslateSelectionOperation,
  type SelectionOperation
} from '../../../editor/selection/selectionTypes';
import {
  identityMatrix,
  matrixApproximatelyEqual,
  multiplyMatrices,
  transformedBounds
} from '../../../editor/tools/transform/affine';
import { projectPoint, solveProjectiveTransform } from '../../../editor/tools/transform/projective';
import type {
  AffineMatrix,
  TransformPoint,
  TransformQuad,
  TransformSessionState
} from '../../../editor/tools/transform/transformTypes';

export interface TransformRendererPort {
  measureSelectedLayerContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null>;
  measureLayerContent(layer: RasterLayer): Promise<SelectionCoverageBounds | null>;
  beginLayerTransform(layer: RasterLayer, useSelection: boolean): void;
  updateLayerTransform(matrix: AffineMatrix): boolean;
  updateLayerProjectiveTransform(source: TransformQuad, destination: TransformQuad): boolean;
  commitLayerTransform(): ReversiblePixelEdit | null;
  cancelLayerTransform(): boolean | void;
  setDuplicateLayerTransform(duplicate: boolean): boolean;
  measureSemanticLayerContent(layer: LayerNode): Promise<SelectionCoverageBounds | null>;
  beginSemanticLayerTransform(layer: LayerNode): boolean;
  updateSemanticLayerTransform(layer: LayerNode, matrix: AffineMatrix): boolean;
  cancelSemanticLayerTransform(layer: LayerNode): boolean | void;
  setSemanticLayerInteraction(layer: LayerNode, active: boolean): boolean | void;
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
    readonly layerId: LayerId;
  }
  | {
    readonly kind: 'selection';
    readonly beforeDocument: ImageDocument;
    readonly afterDocument: ImageDocument;
    readonly beforeSelection: SelectionOperation[];
    readonly afterSelection: SelectionOperation[];
    readonly layerId: LayerId;
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
  private activeSemanticLayer: LayerNode | null = null;
  private launchRevision = 0;

  constructor(private readonly renderer: TransformRendererPort) {}

  get state(): TransformSessionState | null {
    return this.activeState ? {
      ...this.activeState,
      sourceBounds: { ...this.activeState.sourceBounds },
      supportBounds: { ...this.activeState.supportBounds },
      sourceContentBounds: { ...this.activeState.sourceContentBounds },
      sourceMatrix: { ...this.activeState.sourceMatrix },
      matrix: { ...this.activeState.matrix },
      projectiveQuad: this.activeState.projectiveQuad
        ? cloneQuad(this.activeState.projectiveQuad)
        : null
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
    const layer = findDocumentLayer(document, document.activeLayerId);
    const semanticLayer = layer?.type === 'text' || layer?.type === 'vector';
    if (!layer || (layer.type !== 'raster' && !semanticLayer)) {
      return {
        ok: false,
        code: 'invalid-target',
        message: 'Select a raster, text, or vector layer before transforming.'
      };
    }

    const selectionRequested = layer.type === 'raster' && selection.length > 0;
    let usesSelection = selectionRequested
      && matrixApproximatelyEqual(layer.transform, identityMatrix());
    let sourceMatrix = usesSelection ? identityMatrix() : layer.transform;

    try {
      let measuredContent = semanticLayer
        ? await this.renderer.measureSemanticLayerContent(layer)
        : usesSelection
          ? await this.renderer.measureSelectedLayerContent(layer as RasterLayer)
          : await this.renderer.measureLayerContent(layer as RasterLayer);
      if (launchRevision !== this.launchRevision || this.activeState) {
        return { ok: false, code: 'stale', message: null };
      }
      if (!measuredContent && usesSelection) {
        usesSelection = false;
        sourceMatrix = layer.transform;
        measuredContent = await this.renderer.measureLayerContent(layer as RasterLayer);
        if (launchRevision !== this.launchRevision || this.activeState) {
          return { ok: false, code: 'stale', message: null };
        }
      }
      if (!measuredContent) {
        return {
          ok: false,
          code: 'empty-layer',
          message: semanticLayer
            ? 'The semantic layer has no measurable content yet.'
            : 'The active layer does not contain visible pixels.'
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
        sourceContentBounds: { ...measuredContent.coreBounds },
        sourceMatrix: { ...sourceMatrix },
        matrix: identityMatrix(),
        projectiveQuad: null,
        sourceKind: usesSelection ? 'selection' : 'layer',
        previewKind: semanticLayer ? 'semantic' : 'raster'
      };
      const previewStarted = semanticLayer
        ? this.renderer.beginSemanticLayerTransform(layer)
        : (this.renderer.beginLayerTransform(layer as RasterLayer, usesSelection), true);
      const previewUpdated = previewStarted && (semanticLayer
        ? this.renderer.updateSemanticLayerTransform(layer, sourceMatrix)
        : this.renderer.updateLayerTransform(sourceMatrix));
      if (!previewUpdated) {
        if (semanticLayer) {
          this.renderer.cancelSemanticLayerTransform(layer);
          this.renderer.setSemanticLayerInteraction(layer, false);
        }
        else this.renderer.cancelLayerTransform();
        return {
          ok: false,
          code: 'preview-unavailable',
          message: 'The transform preview could not be started.'
        };
      }
      if (semanticLayer) this.renderer.setSemanticLayerInteraction(layer, true);
      this.activeState = state;
      this.activeSemanticLayer = semanticLayer ? layer : null;
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
      if (semanticLayer) {
        this.renderer.cancelSemanticLayerTransform(layer);
        this.renderer.setSemanticLayerInteraction(layer, false);
      }
      else this.renderer.cancelLayerTransform();
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
    if (!this.activeState) return null;
    const nextTransform = multiplyMatrices(matrix, this.activeState.sourceMatrix);
    const previewUpdated = this.activeState.previewKind === 'semantic'
      ? this.updateSemanticPreview(this.activeState.layerId, nextTransform)
      : this.renderer.updateLayerTransform(nextTransform);
    if (!previewUpdated) return null;
    this.activeState = { ...this.activeState, matrix: { ...matrix }, projectiveQuad: null };
    return this.state;
  }

  updateProjective(destination: TransformQuad): TransformSessionState | null {
    if (!this.activeState || this.activeState.previewKind === 'semantic') return null;
    const source = rectToQuad(this.activeState.sourceContentBounds);
    if (!this.renderer.updateLayerProjectiveTransform(source, destination)) return null;
    this.activeState = {
      ...this.activeState,
      matrix: identityMatrix(),
      projectiveQuad: cloneQuad(destination)
    };
    return this.state;
  }

  setDuplicate(duplicate: boolean): boolean {
    return Boolean(
      this.activeState?.sourceKind === 'selection'
      && this.renderer.setDuplicateLayerTransform(duplicate)
    );
  }

  finish(
    document: ImageDocument | null,
    selection: SelectionOperation[],
    commit: boolean
  ): FinishTransformResult {
    const state = this.activeState;
    const semanticLayer = this.activeSemanticLayer;
    this.launchRevision += 1;
    this.activeState = null;
    this.activeSemanticLayer = null;
    if (!state) return { kind: 'unchanged' };
    if (
      !commit
      || !document
      || (!state.projectiveQuad && matrixApproximatelyEqual(state.matrix, identityMatrix()))
    ) {
      this.cancelPreview(state, semanticLayer);
      return { kind: commit ? 'unchanged' : 'cancelled' };
    }

    if (state.sourceKind === 'layer' && !state.projectiveQuad) {
      this.cancelPreview(state, semanticLayer);
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
      state.projectiveQuad
        ? quadBounds(state.projectiveQuad)
        : transformedBounds(state.matrix, state.supportBounds)
    );
    const beforeSelection = cloneSelection(selection);
    const afterSelection = state.projectiveQuad
      ? projectSelectionOperations(
          beforeSelection,
          solveProjectiveTransform(rectToQuad(state.sourceContentBounds), state.projectiveQuad)
        )
      : [
          ...beforeSelection,
          {
            ...createTranslateSelectionOperation(document.width, document.height, 0, 0),
            transform: { ...state.matrix }
          }
        ];
    const afterDocument = state.projectiveQuad
      ? setLayerTransform(
          markLayerPixelsChanged(document, state.layerId, dirtyBounds),
          state.layerId,
          identityMatrix()
        )
      : markLayerPixelsChanged(document, state.layerId, dirtyBounds);
    return {
      kind: 'selection',
      beforeDocument: document,
      afterDocument,
      beforeSelection,
      afterSelection,
      layerId: state.layerId,
      pixelEdit
    };
  }

  private updateSemanticPreview(layerId: LayerId, matrix: AffineMatrix): boolean {
    const layer = this.activeSemanticLayer?.id === layerId ? this.activeSemanticLayer : null;
    return Boolean(layer && this.renderer.updateSemanticLayerTransform(layer, matrix));
  }

  private cancelPreview(state: TransformSessionState, semanticLayer: LayerNode | null): void {
    if (state.previewKind === 'raster') {
      this.renderer.cancelLayerTransform();
      return;
    }
    if (semanticLayer) {
      this.renderer.cancelSemanticLayerTransform(semanticLayer);
      this.renderer.setSemanticLayerInteraction(semanticLayer, false);
    }
  }
}

const rectToQuad = (bounds: Rect): TransformQuad => [
  { x: bounds.x, y: bounds.y },
  { x: bounds.x + bounds.width, y: bounds.y },
  { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  { x: bounds.x, y: bounds.y + bounds.height }
];

const cloneQuad = (quad: TransformQuad): TransformQuad => [
  { ...quad[0] },
  { ...quad[1] },
  { ...quad[2] },
  { ...quad[3] }
];

const quadBounds = (quad: TransformQuad): Rect => {
  const xs = quad.map(({ x }) => x);
  const ys = quad.map(({ y }) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top
  };
};

const projectSelectionOperations = (
  operations: SelectionOperation[],
  transform: ReturnType<typeof solveProjectiveTransform>
): SelectionOperation[] => {
  if (!transform) return cloneSelection(operations);
  return operations.map((operation) => {
    const sourcePoints = operation.shape.kind === 'ellipse' && operation.shape.points.length >= 2
      ? Array.from({ length: 64 }, (_, index) => {
          const [first, second] = operation.shape.points;
          const angle = index / 64 * Math.PI * 2;
          return {
            x: (first.x + second.x) * 0.5 + Math.cos(angle) * Math.abs(second.x - first.x) * 0.5,
            y: (first.y + second.y) * 0.5 + Math.sin(angle) * Math.abs(second.y - first.y) * 0.5
          };
        })
      : operation.shape.kind === 'rectangle' && operation.shape.points.length >= 2
        ? rectToQuad({
            x: Math.min(operation.shape.points[0].x, operation.shape.points[1].x),
            y: Math.min(operation.shape.points[0].y, operation.shape.points[1].y),
            width: Math.abs(operation.shape.points[1].x - operation.shape.points[0].x),
            height: Math.abs(operation.shape.points[1].y - operation.shape.points[0].y)
          })
        : operation.shape.points;
    const points = sourcePoints.map((point) => projectPoint(transform, point));
    if (points.some((point) => point === null)) return cloneSelection([operation])[0];
    return {
      ...operation,
      source: undefined,
      shape: {
        kind: operation.shape.kind === 'free' ? 'free' as const : 'polygon' as const,
        points: points.filter((point): point is TransformPoint => point !== null)
      }
    };
  });
};
