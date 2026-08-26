import { useMemo, useRef } from 'react';
import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import { findDocumentLayer } from '../../../editor/document/layerTree';
import {
  createBorderSelectionOperation,
  createFeatherSelectionOperation,
  createCompositeChannelSelectionOperation,
  createFullCanvasSelection,
  createInvertSelectionOperation,
  createLayerMaskSelectionOperation,
  createLayerTransparencySelectionOperation,
  createMagicWandSelectionOperation,
  createMorphologySelectionOperation,
  createSmoothSelectionOperation,
  createRasterMaskSelectionOperation,
  createTranslateSelectionOperation,
  type CompositeSelectionChannel,
  type MagicWandOptions,
  type RasterSelectionMask,
  type SelectionCombineMode,
  type SelectionMode,
  type SelectionOperation,
  type SelectionPoint,
  type SelectionShape,
  type GeometricSelectionToolId
} from '../../../editor/selection/selectionTypes';
import {
  SelectionGestureController,
  type SelectionGestureRasterOptions,
  type SelectionMarqueeOptions
} from '../../../editor/tools/selection/selectionGestureController';
import {
  PolygonalSelectionGestureController
} from '../../../editor/tools/selection/polygonalSelectionGestureController';
import type { Rect } from '../../../editor/document/documentTypes';
import { selectionOperationsBounds } from '../../../editor/tools/transform/selectionTransform';
import {
  solveSnap,
  translateSnapRect,
  type SnapFeature,
  type SnapMatch
} from '../snapping/snapEngine';

export interface SelectionHistoryEntry {
  label: string;
  type: string;
  documentMutation: false;
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
}

export interface SelectionRendererPort {
  replaceSelection(operations: SelectionOperation[]): Promise<boolean>;
  setSelection(
    shape: SelectionShape,
    mode: SelectionMode,
    featherRadius?: number,
    antiAlias?: boolean
  ): Promise<boolean>;
  clearSelection(): void;
  transformSelection(matrix: { a: number; b: number; c: number; d: number; tx: number; ty: number }): Promise<boolean>;
  applyMagicWand(operation: SelectionOperation): Promise<boolean>;
  applyRasterSelection(operation: SelectionOperation): Promise<boolean>;
}

export interface SelectionSessionDependencies {
  getDocument(): ImageDocument | null;
  getRenderer(): SelectionRendererPort | null;
  getSelection(): SelectionOperation[];
  publishSelection(operations: SelectionOperation[], pointerId: number | null): void;
  publishDraft(shape: SelectionShape | null): void;
  pushHistoryEntry(entry: SelectionHistoryEntry): void;
  setError(message: string | null): void;
  getSnapContext?(movingBounds: Rect): {
    targets: readonly SnapFeature[];
    zoom: number;
    enabled: boolean;
  };
  publishSnapFeedback?(matches: readonly SnapMatch[], bounds: Rect | null): void;
  onShapeCommitted?(command: {
    readonly mode: SelectionCombineMode;
    readonly shape: SelectionShape;
    readonly featherRadius: number;
    readonly antiAlias: boolean;
  }): void;
  onMagicWandCommitted?(command: {
    readonly kind: 'magic-wand';
    readonly layerId: LayerId;
    readonly point: SelectionPoint;
    readonly mode: SelectionCombineMode;
    readonly options: MagicWandOptions;
  }): void;
}

export interface SelectionSessionController {
  get active(): boolean;
  get polygonActive(): boolean;
  get draft(): SelectionShape | null;
  owns(pointerId: number): boolean;
  begin(
    pointerId: number,
    tool: GeometricSelectionToolId,
    point: SelectionPoint,
    mode: SelectionCombineMode,
    stripSize?: number,
    smooth?: number,
    smoothingScale?: number,
    snapBypass?: boolean,
    marqueeOptions?: SelectionMarqueeOptions,
    rasterOptions?: SelectionGestureRasterOptions
  ): boolean;
  move(pointerId: number, point: SelectionPoint, snapBypass?: boolean): boolean;
  moveMany(pointerId: number, points: readonly SelectionPoint[], snapBypass?: boolean): boolean;
  finish(pointerId: number): boolean;
  cancel(pointerId: number): boolean;
  polygonClick(
    point: SelectionPoint,
    closeDistance: number,
    mode: SelectionCombineMode,
    forceClose?: boolean,
    timestamp?: number,
    rasterOptions?: SelectionGestureRasterOptions
  ): boolean;
  polygonMove(point: SelectionPoint): boolean;
  finishPolygon(): boolean;
  cancelPolygon(): boolean;
  reset(): void;
  selectAll(): void;
  clear(): void;
  invert(): void;
  feather(radius: number, applyAtCanvasBounds?: boolean): Promise<boolean>;
  border(width: number): Promise<boolean>;
  smooth(radius: number, applyAtCanvasBounds: boolean): Promise<boolean>;
  morphology(
    mode: 'expand' | 'contract',
    radius: number,
    applyAtCanvasBounds: boolean
  ): Promise<boolean>;
  selectLayerMask(layerId: LayerId): void;
  selectLayerTransparency(layerId: LayerId): void;
  selectCompositeChannel(channel: CompositeSelectionChannel): void;
  translate(x: number, y: number): void;
  magicWand(point: SelectionPoint, mode: SelectionCombineMode, options: MagicWandOptions): boolean;
  applyMagicWand(
    layerId: LayerId,
    point: SelectionPoint,
    mode: SelectionCombineMode,
    options: MagicWandOptions
  ): Promise<boolean>;
  rasterMask(mask: RasterSelectionMask, mode: SelectionCombineMode): Promise<boolean>;
  applyShape(
    shape: SelectionShape,
    mode: SelectionCombineMode,
    featherRadius: number,
    antiAlias: boolean
  ): Promise<boolean>;
  applyState(operation: 'all' | 'clear' | 'invert'): Promise<boolean>;
}

export const cloneSelectionOperations = (
  operations: readonly SelectionOperation[]
): SelectionOperation[] => operations.map((operation) => ({
  mode: operation.mode,
  amount: operation.amount,
  applyAtCanvasBounds: operation.applyAtCanvasBounds,
  antiAlias: operation.antiAlias,
  transform: operation.transform ? { ...operation.transform } : undefined,
  source: operation.source?.kind === 'magic-wand'
    ? {
        ...operation.source,
        point: { ...operation.source.point },
        options: { ...operation.source.options }
      }
    : operation.source?.kind === 'raster-mask'
      ? { ...operation.source, mask: operation.source.mask }
      : operation.source ? { ...operation.source } : undefined,
  shape: {
    ...operation.shape,
    points: operation.shape.points.map((point) => ({ ...point }))
  }
}));

const pointInShape = (shape: SelectionShape, point: SelectionPoint): boolean => {
  if (shape.points.length < 2) return false;
  if (shape.kind === 'rectangle') {
    const [first, last] = shape.points;
    return point.x >= Math.min(first.x, last.x) && point.x <= Math.max(first.x, last.x)
      && point.y >= Math.min(first.y, last.y) && point.y <= Math.max(first.y, last.y);
  }
  if (shape.kind === 'ellipse') {
    const [first, last] = shape.points;
    const rx = Math.abs(last.x - first.x) / 2;
    const ry = Math.abs(last.y - first.y) / 2;
    if (rx < 1e-6 || ry < 1e-6) return false;
    const cx = (first.x + last.x) / 2;
    const cy = (first.y + last.y) / 2;
    return ((point.x - cx) / rx) ** 2 + ((point.y - cy) / ry) ** 2 <= 1;
  }
  let inside = false;
  const points = shape.points;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const first = points[index];
    const second = points[previous];
    if (((first.y > point.y) !== (second.y > point.y))
      && point.x < (second.x - first.x) * (point.y - first.y)
        / (second.y - first.y || 1e-12) + first.x) inside = !inside;
  }
  return inside;
};

const selectionContainsPoint = (
  operations: readonly SelectionOperation[],
  point: SelectionPoint
): boolean => {
  let sample = (_point: SelectionPoint) => false;
  operations.forEach((operation) => {
    const previous = sample;
    if (operation.mode === 'transform' && operation.transform) {
      const matrix = operation.transform;
      const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
      if (Math.abs(determinant) < 1e-8) return;
      sample = (target) => previous({
        x: (matrix.d * (target.x - matrix.tx) - matrix.c * (target.y - matrix.ty)) / determinant,
        y: (-matrix.b * (target.x - matrix.tx) + matrix.a * (target.y - matrix.ty)) / determinant
      });
      return;
    }
    if (operation.mode === 'feather' || operation.mode === 'border'
      || operation.mode === 'smooth' || operation.mode === 'expand'
      || operation.mode === 'contract') return;
    if (operation.mode === 'invert') {
      sample = (target) => !previous(target);
      return;
    }
    const shapeSample = operation.source
      ? (_target: SelectionPoint) => false
      : (target: SelectionPoint) => pointInShape(operation.shape, target);
    sample = operation.mode === 'replace'
      ? shapeSample
      : operation.mode === 'add'
        ? (target) => previous(target) || shapeSample(target)
        : operation.mode === 'subtract'
          ? (target) => previous(target) && !shapeSample(target)
          : (target) => previous(target) && shapeSample(target);
  });
  return sample(point);
};

/**
 * Owns selection gestures, command publication and selection-only history.
 *
 * Selection rendering is asynchronous. Every transaction therefore captures
 * the document and renderer that started it, and rejects stale completion
 * after a document switch or renderer replacement.
 */
export const createSelectionSessionController = (
  resolveDependencies: () => SelectionSessionDependencies,
  gesture = new SelectionGestureController(),
  polygonGesture = new PolygonalSelectionGestureController()
): SelectionSessionController => {
  let magicWandRequestId = 0;
  let pendingMagicWandSnapshot: SelectionOperation[] | null = null;
  let marqueeTool: GeometricSelectionToolId | null = null;
  let translation: {
    pointerId: number;
    document: ImageDocument;
    renderer: SelectionRendererPort;
    before: SelectionOperation[];
    last: SelectionPoint;
    sourceBounds: Rect;
    x: number;
    y: number;
  } | null = null;
  const translateSnapshot = (x: number, y: number) => {
    if (!x && !y) return;
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    const before = cloneSelectionOperations(dependencies.getSelection());
    if (!document || !renderer || !before.length) return;
    const operation = createTranslateSelectionOperation(document.width, document.height, x, y);
    const after = [...before, operation];
    void renderer.transformSelection(operation.transform!)
      .then((applied) => {
        if (!applied || !isCurrent(document, renderer)) return;
        const latest = resolveDependencies();
        latest.publishSelection(after, null);
        pushHistory(document, before, after);
        latest.setError(null);
      })
      .catch((reason) => {
        if (!isCurrent(document, renderer)) return;
        resolveDependencies().setError(
          reason instanceof Error ? reason.message : 'The selection could not be moved.'
        );
      });
  };
  const isCurrent = (
    document: ImageDocument,
    renderer: SelectionRendererPort
  ): boolean => {
    const latest = resolveDependencies();
    return latest.getDocument()?.id === document.id && latest.getRenderer() === renderer;
  };

  const replaceSnapshot = async (
    operations: SelectionOperation[],
    expectedDocumentId?: ImageDocument['id']
  ): Promise<void> => {
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!document || !renderer || (expectedDocumentId && document.id !== expectedDocumentId)) {
      throw new Error('The selection belongs to a different document.');
    }
    const snapshot = cloneSelectionOperations(operations);
    if (!await renderer.replaceSelection(snapshot) || !isCurrent(document, renderer)) {
      throw new Error('The LightTable selection could not be restored.');
    }
    resolveDependencies().publishSelection(snapshot, null);
  };

  const pushHistory = (
    document: ImageDocument,
    before: SelectionOperation[],
    after: SelectionOperation[]
  ) => {
    const previous = cloneSelectionOperations(before);
    const next = cloneSelectionOperations(after);
    const mode = next.at(-1)?.mode;
    const label = next.length === 0 ? 'Deselect'
      : mode === 'invert' ? 'Inverse'
        : mode === 'feather' ? 'Feather Selection'
          : mode === 'border' ? 'Border Selection'
            : mode === 'smooth' ? 'Smooth Selection'
              : mode === 'expand' ? 'Expand Selection'
                : mode === 'contract' ? 'Contract Selection'
                  : mode === 'transform' ? 'Transform Selection'
                    : 'Make Selection';
    resolveDependencies().pushHistoryEntry({
      label,
      type: `selection.${mode ?? 'deselect'}`,
      documentMutation: false,
      undo: () => replaceSnapshot(previous, document.id),
      redo: () => replaceSnapshot(next, document.id)
    });
  };

  const commitSnapshot = async (
    after: SelectionOperation[],
    failureMessage: string
  ): Promise<boolean> => {
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!document || !renderer) return false;
    const before = cloneSelectionOperations(dependencies.getSelection());
    const snapshot = cloneSelectionOperations(after);
    gesture.reset();
    dependencies.publishDraft(null);
    dependencies.publishSelection(before, null);
    try {
      const applied = await renderer.replaceSelection(snapshot);
      if (!applied || !isCurrent(document, renderer)) return false;
      const latest = resolveDependencies();
      latest.publishSelection(snapshot, null);
      pushHistory(document, before, snapshot);
      latest.setError(null);
      return true;
    } catch (reason) {
      if (isCurrent(document, renderer)) {
        resolveDependencies().setError(
          reason instanceof Error ? reason.message : failureMessage
        );
      }
      return false;
    }
  };

  const applyGestureResult = (
    result: ReturnType<SelectionGestureController['finish']>
  ): boolean => {
    if (!result) return false;
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    dependencies.publishDraft(null);
    dependencies.publishSnapFeedback?.([], null);
    marqueeTool = null;
    dependencies.publishSelection(dependencies.getSelection(), null);
    if (!document || !renderer || result.kind === 'none') return true;
    const before = cloneSelectionOperations(dependencies.getSelection());
    if (result.kind === 'clear') {
      renderer.clearSelection();
      dependencies.publishSelection([], null);
      if (before.length) pushHistory(document, before, []);
      return true;
    }
    const operation: SelectionOperation = {
      mode: result.mode,
      shape: result.shape,
      ...(result.featherRadius > 0 ? { amount: result.featherRadius } : {}),
      ...(result.antiAlias ? { antiAlias: true } : {})
    };
    const after = result.mode === 'replace'
      ? [operation]
      : [...before, operation];
    const applySelection = result.antiAlias
      ? renderer.setSelection(
          result.shape,
          result.mode,
          result.featherRadius,
          true
        )
      : result.featherRadius > 0
        ? renderer.setSelection(result.shape, result.mode, result.featherRadius)
        : renderer.setSelection(result.shape, result.mode);
    void applySelection
      .then((applied) => {
        if (!applied || !isCurrent(document, renderer)) return;
        const latest = resolveDependencies();
        latest.publishSelection(after, null);
        pushHistory(document, before, after);
        latest.setError(null);
        latest.onShapeCommitted?.({
          mode: result.mode,
          shape: {
            ...result.shape,
            points: result.shape.points.map((point) => ({ ...point }))
          },
          featherRadius: result.featherRadius,
          antiAlias: result.antiAlias
        });
      })
      .catch((reason) => {
        if (!isCurrent(document, renderer)) return;
        resolveDependencies().setError(
          reason instanceof Error
            ? reason.message
            : 'The selection could not be applied.'
        );
      });
    return true;
  };

  const applyShape = async (
    shape: SelectionShape,
    mode: SelectionCombineMode,
    featherRadius: number,
    antiAlias: boolean
  ): Promise<boolean> => {
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!document || !renderer) return false;
    const before = cloneSelectionOperations(dependencies.getSelection());
    const operation: SelectionOperation = {
      mode,
      shape: { ...shape, points: shape.points.map((point) => ({ ...point })) },
      ...(featherRadius > 0 ? { amount: featherRadius } : {}),
      ...(antiAlias ? { antiAlias: true } : {})
    };
    const after = mode === 'replace' ? [operation] : [...before, operation];
    try {
      const applied = await renderer.setSelection(shape, mode, featherRadius, antiAlias);
      if (!applied || !isCurrent(document, renderer)) return false;
      const latest = resolveDependencies();
      latest.publishSelection(after, null);
      pushHistory(document, before, after);
      latest.setError(null);
      return true;
    } catch (reason) {
      if (!isCurrent(document, renderer)) return false;
      resolveDependencies().setError(
        reason instanceof Error ? reason.message : 'The selection could not be applied.'
      );
      return false;
    }
  };

  const moveMany = (
    pointerId: number,
    points: readonly SelectionPoint[],
    snapBypass = false
  ): boolean => {
    if (!points.length) return false;
    const point = points[points.length - 1];
    if (translation?.pointerId === pointerId) {
      const rawX = translation.x + point.x - translation.last.x;
      const rawY = translation.y + point.y - translation.last.y;
      translation.last = point;
      const proposedBounds = translateSnapRect(translation.sourceBounds, rawX, rawY);
      const snapContext = resolveDependencies().getSnapContext?.(proposedBounds);
      const snap = snapContext
        ? solveSnap({
            movingBounds: proposedBounds,
            targets: snapContext.targets,
            zoom: snapContext.zoom,
            enabled: snapContext.enabled,
            bypass: snapBypass
          })
        : { offsetX: 0, offsetY: 0, matches: [] as readonly SnapMatch[] };
      const nextX = rawX + snap.offsetX;
      const nextY = rawY + snap.offsetY;
      const dx = nextX - translation.x;
      const dy = nextY - translation.y;
      translation.x = nextX;
      translation.y = nextY;
      if (dx || dy) void translation.renderer.transformSelection({
        a: 1, b: 0, c: 0, d: 1, tx: dx, ty: dy
      });
      const operation = createTranslateSelectionOperation(
        translation.document.width,
        translation.document.height,
        translation.x,
        translation.y
      );
      resolveDependencies().publishSelection([...translation.before, operation], pointerId);
      resolveDependencies().publishSnapFeedback?.(
        snap.matches,
        translateSnapRect(translation.sourceBounds, translation.x, translation.y)
      );
      return true;
    }
    let marqueeMatches: readonly SnapMatch[] = [];
    let gesturePoints = points;
    if (marqueeTool && marqueeTool !== 'select-free') {
      const snapContext = resolveDependencies().getSnapContext?.({
        x: point.x, y: point.y, width: 0, height: 0
      });
      if (snapContext) {
        const relevantTargets = marqueeTool === 'select-horizontal'
          ? snapContext.targets.filter(({ axis }) => axis === 'y')
          : marqueeTool === 'select-vertical'
            ? snapContext.targets.filter(({ axis }) => axis === 'x')
            : snapContext.targets;
        const snap = solveSnap({
          movingBounds: { x: point.x, y: point.y, width: 0, height: 0 },
          targets: relevantTargets,
          zoom: snapContext.zoom,
          enabled: snapContext.enabled,
          bypass: snapBypass
        });
        marqueeMatches = snap.matches;
        gesturePoints = [
          ...points.slice(0, -1),
          { ...point, x: point.x + snap.offsetX, y: point.y + snap.offsetY }
        ];
      }
    }
    const draft = gesture.moveMany(pointerId, gesturePoints);
    if (!draft) return false;
    resolveDependencies().publishDraft(draft);
    if (marqueeTool && marqueeTool !== 'select-free') {
      const xs = draft.points.map(({ x }) => x);
      const ys = draft.points.map(({ y }) => y);
      resolveDependencies().publishSnapFeedback?.(marqueeMatches, {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys)
      });
    }
    return true;
  };

  const runMagicWand = async (
    layerId: LayerId,
    point: SelectionPoint,
    mode: SelectionCombineMode,
    options: MagicWandOptions,
    recordObserved: boolean
  ): Promise<boolean> => {
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!document || !renderer || !findDocumentLayer(document, layerId)) return false;
    const before = cloneSelectionOperations(
      pendingMagicWandSnapshot ?? dependencies.getSelection()
    );
    const operation = createMagicWandSelectionOperation(
      layerId,
      document.revision,
      document.width,
      document.height,
      point,
      options,
      mode
    );
    const after = mode === 'replace' ? [operation] : [...before, operation];
    const requestId = ++magicWandRequestId;
    pendingMagicWandSnapshot = cloneSelectionOperations(after);
    try {
      const applied = await renderer.applyMagicWand(operation);
      if (!applied || !isCurrent(document, renderer)) {
        if (requestId === magicWandRequestId && isCurrent(document, renderer)) {
          pendingMagicWandSnapshot = null;
          resolveDependencies().setError('The Magic Wand selection could not be applied.');
        }
        return false;
      }
      if (requestId !== magicWandRequestId) {
        if (pendingMagicWandSnapshot) pushHistory(document, before, after);
        return true;
      }
      pushHistory(document, before, after);
      const latest = resolveDependencies();
      pendingMagicWandSnapshot = null;
      latest.publishSelection(after, null);
      latest.setError(null);
      if (recordObserved) {
        const source = operation.source?.kind === 'magic-wand' ? operation.source : null;
        if (source) latest.onMagicWandCommitted?.({
          kind: 'magic-wand',
          layerId: source.layerId,
          point: { x: source.point.x, y: source.point.y },
          mode,
          options: { ...source.options }
        });
      }
      return true;
    } catch (reason) {
      if (requestId !== magicWandRequestId || !isCurrent(document, renderer)) return false;
      pendingMagicWandSnapshot = null;
      resolveDependencies().setError(
        reason instanceof Error ? reason.message : 'The Magic Wand selection could not be applied.'
      );
      return false;
    }
  };

  return {
    get active() {
      return gesture.pointerId !== null || polygonGesture.active || translation !== null;
    },
    get polygonActive() {
      return polygonGesture.active;
    },
    get draft() {
      return polygonGesture.draft ?? gesture.draft;
    },
    owns: (pointerId) => gesture.owns(pointerId) || translation?.pointerId === pointerId,
    begin: (
      pointerId,
      tool,
      point,
      mode,
      stripSize,
      smooth,
      smoothingScale,
      snapBypass = false,
      marqueeOptions,
      rasterOptions
    ) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      const renderer = dependencies.getRenderer();
      if (!document || !renderer) return false;
      const before = cloneSelectionOperations(dependencies.getSelection());
      if (mode === 'replace' && before.length && selectionContainsPoint(before, point)) {
        const sourceBounds = selectionOperationsBounds(before, {
          x: 0, y: 0, width: document.width, height: document.height
        });
        translation = { pointerId, document, renderer, before, last: point, sourceBounds, x: 0, y: 0 };
        dependencies.publishSelection(before, pointerId);
        dependencies.publishSnapFeedback?.([], sourceBounds);
        return true;
      }
      const marqueeSnap = tool === 'select-free'
        ? null
        : dependencies.getSnapContext?.({ x: point.x, y: point.y, width: 0, height: 0 });
      const relevantTargets = marqueeSnap
        ? tool === 'select-horizontal'
          ? marqueeSnap.targets.filter(({ axis }) => axis === 'y')
          : tool === 'select-vertical'
            ? marqueeSnap.targets.filter(({ axis }) => axis === 'x')
            : marqueeSnap.targets
        : [];
      const snap = marqueeSnap
        ? solveSnap({
            movingBounds: { x: point.x, y: point.y, width: 0, height: 0 },
            targets: relevantTargets,
            zoom: marqueeSnap.zoom,
            enabled: marqueeSnap.enabled,
            bypass: snapBypass
          })
        : { offsetX: 0, offsetY: 0, matches: [] as readonly SnapMatch[] };
      const snappedPoint = { x: point.x + snap.offsetX, y: point.y + snap.offsetY };
      marqueeTool = tool;
      const draft = gesture.begin(pointerId, tool, snappedPoint, mode, {
        documentWidth: document.width,
        documentHeight: document.height,
        size: stripSize ?? 1
      }, smooth, smoothingScale, marqueeOptions, rasterOptions);
      dependencies.publishDraft(draft);
      dependencies.publishSnapFeedback?.(snap.matches, snap.matches.length ? {
        x: snappedPoint.x, y: snappedPoint.y, width: 0, height: 0
      } : null);
      dependencies.publishSelection(dependencies.getSelection(), pointerId);
      return true;
    },
    move: (pointerId, point, snapBypass) => moveMany(pointerId, [point], snapBypass),
    moveMany,
    finish: (pointerId) => {
      if (translation?.pointerId === pointerId) {
        const current = translation;
        translation = null;
        const after = current.x || current.y
          ? [...current.before, createTranslateSelectionOperation(
              current.document.width,
              current.document.height,
              current.x,
              current.y
            )]
          : current.before;
        resolveDependencies().publishSelection(after, null);
        resolveDependencies().publishSnapFeedback?.([], null);
        if (after !== current.before) pushHistory(current.document, current.before, after);
        return true;
      }
      const result = gesture.finish(pointerId);
      return applyGestureResult(result);
    },
    cancel: (pointerId) => {
      if (translation?.pointerId === pointerId) {
        const current = translation;
        translation = null;
        void current.renderer.replaceSelection(current.before);
        resolveDependencies().publishSelection(current.before, null);
        resolveDependencies().publishSnapFeedback?.([], null);
        return true;
      }
      if (!gesture.cancel(pointerId)) return false;
      marqueeTool = null;
      const dependencies = resolveDependencies();
      dependencies.publishDraft(null);
      dependencies.publishSnapFeedback?.([], null);
      dependencies.publishSelection(dependencies.getSelection(), null);
      return true;
    },
    polygonClick: (
      point,
      closeDistance,
      mode,
      forceClose = false,
      timestamp = Date.now(),
      rasterOptions
    ) => {
      const dependencies = resolveDependencies();
      if (!dependencies.getDocument() || !dependencies.getRenderer()) return false;
      const result = polygonGesture.click(
        point,
        mode,
        closeDistance,
        forceClose,
        timestamp,
        rasterOptions
      );
      if (result.kind === 'finish') return applyGestureResult(result.result);
      dependencies.publishDraft(result.shape);
      dependencies.publishSelection(dependencies.getSelection(), null);
      return true;
    },
    polygonMove: (point) => {
      const draft = polygonGesture.move(point);
      if (!draft) return false;
      resolveDependencies().publishDraft(draft);
      return true;
    },
    magicWand: (point, mode, options) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      if (!document?.activeLayerId || !dependencies.getRenderer()) return false;
      void runMagicWand(document.activeLayerId, point, mode, options, true);
      return true;
    },
    applyMagicWand: (layerId, point, mode, options) =>
      runMagicWand(layerId, point, mode, options, false),
    rasterMask: async (mask, mode) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      const renderer = dependencies.getRenderer();
      if (!document || !renderer
        || mask.width !== document.width || mask.height !== document.height
        || mask.data.byteLength !== document.width * document.height) return false;
      const before = cloneSelectionOperations(dependencies.getSelection());
      const operation = createRasterMaskSelectionOperation(
        document.revision,
        document.width,
        document.height,
        mask,
        mode
      );
      const after = mode === 'replace' ? [operation] : [...before, operation];
      try {
        const applied = await renderer.applyRasterSelection(operation);
        if (!applied || !isCurrent(document, renderer)) return false;
        const latest = resolveDependencies();
        latest.publishSelection(after, null);
        pushHistory(document, before, after);
        latest.setError(null);
        return true;
      } catch (reason) {
        if (!isCurrent(document, renderer)) return false;
        resolveDependencies().setError(
          reason instanceof Error ? reason.message : 'The object selection could not be applied.'
        );
        return false;
      }
    },
    applyShape,
    finishPolygon: () => (
      polygonGesture.active
        ? applyGestureResult(polygonGesture.finish())
        : false
    ),
    cancelPolygon: () => {
      if (!polygonGesture.cancel()) return false;
      const dependencies = resolveDependencies();
      dependencies.publishDraft(null);
      dependencies.publishSelection(dependencies.getSelection(), null);
      return true;
    },
    reset: () => {
      const restoreSelectionAfterMagicWand = pendingMagicWandSnapshot !== null;
      magicWandRequestId += 1;
      pendingMagicWandSnapshot = null;
      translation = null;
      marqueeTool = null;
      resolveDependencies().publishSnapFeedback?.([], null);
      gesture.reset();
      polygonGesture.reset();
      const dependencies = resolveDependencies();
      dependencies.publishDraft(null);
      dependencies.publishSelection(dependencies.getSelection(), null);
      if (restoreSelectionAfterMagicWand) {
        const document = dependencies.getDocument();
        const renderer = dependencies.getRenderer();
        const snapshot = cloneSelectionOperations(dependencies.getSelection());
        if (document && renderer) {
          void renderer.replaceSelection(snapshot).catch((reason) => {
            if (!isCurrent(document, renderer)) return;
            resolveDependencies().setError(
              reason instanceof Error ? reason.message : 'The selection could not be restored.'
            );
          });
        }
      }
    },
    selectAll: () => {
      const document = resolveDependencies().getDocument();
      if (!document) return;
      void commitSnapshot(
        createFullCanvasSelection(document.width, document.height),
        'The complete canvas could not be selected.'
      );
    },
    clear: () => {
      const dependencies = resolveDependencies();
      if (!dependencies.getSelection().length && !gesture.draft) return;
      void commitSnapshot([], 'The selection could not be cleared.');
    },
    invert: () => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      if (!document) return;
      void commitSnapshot(
        [
          ...cloneSelectionOperations(dependencies.getSelection()),
          createInvertSelectionOperation(document.width, document.height)
        ],
        'The selection could not be inverted.'
      );
    },
    applyState: async (operation) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      if (!document) return false;
      if (operation === 'all') {
        return commitSnapshot(
          createFullCanvasSelection(document.width, document.height),
          'The complete canvas could not be selected.'
        );
      }
      if (operation === 'clear') {
        if (!dependencies.getSelection().length && !gesture.draft) return true;
        return commitSnapshot([], 'The selection could not be cleared.');
      }
      return commitSnapshot(
        [
          ...cloneSelectionOperations(dependencies.getSelection()),
          createInvertSelectionOperation(document.width, document.height)
        ],
        'The selection could not be inverted.'
      );
    },
    feather: (radius, applyAtCanvasBounds = false) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      if (!document || !dependencies.getSelection().length) return Promise.resolve(false);
      return commitSnapshot(
        [
          ...cloneSelectionOperations(dependencies.getSelection()),
          createFeatherSelectionOperation(
            document.width,
            document.height,
            radius,
            applyAtCanvasBounds
          )
        ],
        'The selection could not be feathered.'
      );
    },
    border: (width) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      if (!document || !dependencies.getSelection().length) return Promise.resolve(false);
      return commitSnapshot(
        [
          ...cloneSelectionOperations(dependencies.getSelection()),
          createBorderSelectionOperation(document.width, document.height, width)
        ],
        'The selection border could not be created.'
      );
    },
    smooth: (radius, applyAtCanvasBounds) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      if (!document || !dependencies.getSelection().length) return Promise.resolve(false);
      return commitSnapshot(
        [
          ...cloneSelectionOperations(dependencies.getSelection()),
          createSmoothSelectionOperation(
            document.width,
            document.height,
            radius,
            applyAtCanvasBounds
          )
        ],
        'The selection could not be smoothed.'
      );
    },
    morphology: (mode, radius, applyAtCanvasBounds) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      if (!document || !dependencies.getSelection().length) return Promise.resolve(false);
      return commitSnapshot(
        [
          ...cloneSelectionOperations(dependencies.getSelection()),
          createMorphologySelectionOperation(
            document.width,
            document.height,
            mode,
            radius,
            applyAtCanvasBounds
          )
        ],
        `The selection could not be ${mode === 'expand' ? 'expanded' : 'contracted'}.`
      );
    },
    selectLayerMask: (layerId) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      const layer = document ? findDocumentLayer(document, layerId) : null;
      if (!document || !layer?.mask) return;
      void commitSnapshot(
        [createLayerMaskSelectionOperation(
          layer.id,
          layer.mask.pixelRevision,
          document.width,
          document.height
        )],
        'The layer mask could not be loaded as a selection.'
      );
    },
    selectLayerTransparency: (layerId) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      const layer = document ? findDocumentLayer(document, layerId) : null;
      if (!document || layer?.type !== 'raster') return;
      void commitSnapshot(
        [createLayerTransparencySelectionOperation(
          layer.id,
          layer.pixelRevision,
          document.width,
          document.height
        )],
        'The layer transparency could not be loaded as a selection.'
      );
    },
    selectCompositeChannel: (channel) => {
      const document = resolveDependencies().getDocument();
      if (!document) return;
      void commitSnapshot(
        [createCompositeChannelSelectionOperation(
          channel,
          document.revision,
          document.width,
          document.height
        )],
        'The composite channel could not be loaded as a selection.'
      );
    },
    translate: translateSnapshot
  };
};

export const useSelectionSessionController = (
  dependencies: SelectionSessionDependencies,
  gesture?: SelectionGestureController
): SelectionSessionController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  return useMemo(
    () => createSelectionSessionController(
      () => dependenciesRef.current,
      gesture
    ),
    [gesture]
  );
};
