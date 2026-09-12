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
  createObjectSelectionOperation,
  createMorphologySelectionOperation,
  createSmoothSelectionOperation,
  createSimilarSelectionOperation,
  createTranslateSelectionOperation,
  type CompositeSelectionChannel,
  type MagicWandOptions,
  type RasterSelectionMask,
  type SelectionCombineMode,
  type SelectionMode,
  type SelectionOperation,
  type SelectionPoint,
  type SelectionShape,
  type SimilarSelectionOptions,
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
import type { BrushPoint } from '../../../editor/tools/brush/strokeBuilder';
import { selectionOperationsEditingBounds } from '../../../editor/tools/transform/selectionTransform';
import {
  solveSnap,
  translateSnapRect,
  type SnapFeature,
  type SnapMatch
} from '../snapping/snapEngine';
import { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import type {
  SelectionRendererPort,
  SelectionSessionDependencies,
} from './selectionSessionPorts';
import { committedSelectionContainsPoint } from './selectionHitTesting';
import { SelectionPaintGestureController } from './SelectionPaintGestureController';
export type { SelectionRendererPort, SelectionSessionDependencies } from './selectionSessionPorts';

export interface SelectionSessionController {
  get active(): boolean;
  get polygonActive(): boolean;
  get draft(): SelectionShape | null;
  owns(pointerId: number): boolean;
  contains(point: SelectionPoint): boolean;
  begin(
    pointerId: number,
    tool: GeometricSelectionToolId,
    point: SelectionPoint,
    mode: SelectionCombineMode,
    stripSize?: number,
    smooth?: number,
    smoothingScale?: number,
    marqueeOptions?: SelectionMarqueeOptions,
    rasterOptions?: SelectionGestureRasterOptions
  ): boolean;
  move(
    pointerId: number,
    point: SelectionPoint,
    repositionDraft?: boolean,
    marqueeModifiers?: { constrainAspect: boolean; fromCenter: boolean },
    constrainTranslation?: boolean
  ): boolean;
  moveMany(
    pointerId: number,
    points: readonly SelectionPoint[],
    repositionDraft?: boolean,
    marqueeModifiers?: { constrainAspect: boolean; fromCenter: boolean },
    constrainTranslation?: boolean
  ): boolean;
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
  /** Retires transient work without publishing into a closing or successor document. */
  retire(): void;
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
  selectLayerMask(layerId: LayerId): Promise<boolean>;
  selectLayerTransparency(layerId: LayerId): Promise<boolean>;
  selectCompositeChannel(channel: CompositeSelectionChannel): void;
  translate(x: number, y: number): void;
  settle(): Promise<void>;
  magicWand(point: SelectionPoint, mode: SelectionCombineMode, options: MagicWandOptions): boolean;
  applyMagicWand(
    layerId: LayerId,
    point: SelectionPoint,
    mode: SelectionCombineMode,
    options: MagicWandOptions
  ): Promise<boolean>;
  selectSimilar(layerId: LayerId, options: SimilarSelectionOptions): Promise<boolean>;
  rasterMask(
    mask: RasterSelectionMask,
    mode: SelectionCombineMode,
    signal?: AbortSignal,
  ): Promise<boolean>;
  beginPaint(
    pointerId: number,
    point: BrushPoint,
    mode: 'add' | 'subtract',
    options: { size: number; hardness: number; opacity: number; smooth: number }
  ): boolean;
  movePaint(pointerId: number, points: readonly BrushPoint[]): boolean;
  finishPaint(pointerId: number): boolean;
  cancelPaint(pointerId: number): boolean;
  ownsPaint(pointerId: number): boolean;
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
    : operation.source?.kind === 'similar'
      ? { ...operation.source, options: { ...operation.source.options } }
    : operation.source?.kind === 'raster-mask'
      ? { ...operation.source, mask: operation.source.mask }
      : operation.source?.kind === 'selection-paint'
        ? {
            ...operation.source,
            dabs: operation.source.dabs.map((dab) => ({ ...dab }))
          }
      : operation.source ? { ...operation.source } : undefined,
  shape: {
    ...operation.shape,
    points: operation.shape.points.map((point) => ({ ...point }))
  }
}));

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
  let magicWandGeneration = 0;
  let retirementEpoch = 0;
  const magicWandAborts = new Set<AbortController>();
  let marqueeTool: GeometricSelectionToolId | null = null;
  let marqueeSnapMatches: readonly SnapMatch[] = [];
  let gestureOwner: {
    document: ImageDocument;
    renderer: SelectionRendererPort;
    onShapeCommitted: SelectionSessionDependencies['onShapeCommitted'];
  } | null = null;
  let translation: {
    pointerId: number;
    document: ImageDocument;
    renderer: SelectionRendererPort;
    before: SelectionOperation[];
    last: SelectionPoint;
    sourceBounds: Rect;
    x: number;
    y: number;
    rawX: number;
    rawY: number;
    snapMatches: readonly SnapMatch[];
    stopped: boolean;
  } | null = null;
  let translateQueue: Promise<void> = Promise.resolve();
  let commitQueue: Promise<void> = Promise.resolve();
  let commitActive = false;
  let queuedTranslationSelection: SelectionOperation[] | null = null;
  const queueCommit = <Result,>(operation: (isAdmitted: () => boolean) => Promise<Result>): Promise<Result> => {
    const epoch = retirementEpoch;
    const run = () => operation(() => epoch === retirementEpoch);
    let task: Promise<Result>;
    if (!commitActive) {
      commitActive = true;
      try {
        task = run();
      } catch (reason) {
        task = Promise.reject(reason);
      }
    } else {
      task = commitQueue.then(run, run);
    }
    const tail = task.then(() => undefined, () => undefined);
    commitQueue = tail;
    void tail.then(() => {
      if (commitQueue === tail) commitActive = false;
    });
    return task;
  };
  const translateSnapshot = (x: number, y: number) => {
    if (!x && !y) return;
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    const before = cloneSelectionOperations(
      queuedTranslationSelection ?? dependencies.getSelection()
    );
    if (!document || !renderer || !hasCommittedSelection(dependencies)) return;
    const operation = createTranslateSelectionOperation(document.width, document.height, x, y);
    const after = [...before, operation];
    queuedTranslationSelection = after;
    const execution = queueCommit((isAdmitted) => {
      if (!isAdmitted() || !isCurrent(document, renderer)) return Promise.resolve(false);
      return resolveDependencies().commitTranslation({ x, y, provenance: operation });
    }).then(() => undefined).finally(() => {
      if (queuedTranslationSelection === after) queuedTranslationSelection = null;
    });
    translateQueue = execution;
  };
  const isCurrent = (
    document: ImageDocument,
    renderer: SelectionRendererPort
  ): boolean => {
    const latest = resolveDependencies();
    return latest.getDocument() === document && latest.getRenderer() === renderer;
  };
  const documentCommittedMask = (
    dependencies: SelectionSessionDependencies,
    document: ImageDocument,
    operations: readonly SelectionOperation[] = dependencies.getSelection()
  ): SelectionMaskSnapshot | null => {
    const snapshot = dependencies.getSelectionMaskSnapshot();
    if (snapshot?.width === document.width && snapshot.height === document.height) {
      return snapshot;
    }
    if (operations.length === 0) {
      return SelectionMaskSnapshot.inactive(document.width, document.height);
    }
    return null;
  };
  const hasCommittedSelection = (dependencies: SelectionSessionDependencies): boolean =>
    dependencies.getSelectionMaskSnapshot()?.active === true;
  const notifyObservedCommit = (
    dependencies: SelectionSessionDependencies,
    observe: (() => void) | undefined
  ) => {
    try {
      observe?.();
    } catch (reason) {
      dependencies.setError(
        reason instanceof Error
          ? `The selection was applied, but action recording failed: ${reason.message}`
          : 'The selection was applied, but action recording failed.'
      );
    }
  };
  const paint = new SelectionPaintGestureController({
    resolveDependencies,
    queueCommit,
    isCurrent,
    cloneSelection: cloneSelectionOperations,
    committedMask: documentCommittedMask,
    notifyObservedCommit
  });

  const commitSnapshot = (
    after: SelectionOperation[],
    failureMessage: string
  ): Promise<boolean> => {
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!document || !renderer) return Promise.resolve(false);
    gesture.reset();
    dependencies.publishDraft(null);
    dependencies.publishPointer(null);
    const operation = after.at(-1) ?? null;
    return queueCommit(async (isAdmitted) => {
      if (!isAdmitted() || !isCurrent(document, renderer)) return false;
      const applied = await resolveDependencies().commitOperation({ operation });
      if (isAdmitted() && isCurrent(document, renderer)) {
        dependencies.setError(applied ? null : failureMessage);
      }
      return applied;
    });
  };

  const applyGestureResult = (
    result: ReturnType<SelectionGestureController['finish']>
  ): boolean => {
    if (!result) return false;
    const dependencies = resolveDependencies();
    const owner = gestureOwner;
    const onShapeCommitted = owner?.onShapeCommitted;
    gestureOwner = null;
    const document = owner?.document ?? dependencies.getDocument();
    const renderer = owner?.renderer ?? dependencies.getRenderer();
    dependencies.publishDraft(null);
    dependencies.publishSnapFeedback?.([], null);
    marqueeTool = null;
    marqueeSnapMatches = [];
    dependencies.publishPointer(null);
    if (!document || !renderer || !isCurrent(document, renderer) || result.kind === 'none') return true;
    if (result.kind === 'clear') {
      void commitSnapshot([], 'The selection could not be cleared.');
      return true;
    }
    const operation: SelectionOperation = {
      mode: result.mode,
      shape: result.shape,
      ...(result.featherRadius > 0 ? { amount: result.featherRadius } : {}),
      ...(result.antiAlias ? { antiAlias: true } : {})
    };
    void queueCommit(async (isAdmitted) => {
      if (!isAdmitted() || !isCurrent(document, renderer)) return false;
      const applied = await resolveDependencies().commitShape({
        mode: result.mode,
        shape: result.shape,
        featherRadius: result.featherRadius,
        antiAlias: result.antiAlias,
        provenance: operation,
      });
      if (!isAdmitted()) return false;
      const latest = resolveDependencies();
      if (applied) {
        latest.setError(null);
        notifyObservedCommit(latest, () => onShapeCommitted?.({
          mode: result.mode,
          shape: { ...result.shape, points: result.shape.points.map((point) => ({ ...point })) },
          featherRadius: result.featherRadius,
          antiAlias: result.antiAlias,
        }));
      } else latest.setError('The selection could not be applied.');
      return applied;
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
    const operation: SelectionOperation = {
      mode,
      shape: { ...shape, points: shape.points.map((point) => ({ ...point })) },
      ...(featherRadius > 0 ? { amount: featherRadius } : {}),
      ...(antiAlias ? { antiAlias: true } : {})
    };
    return queueCommit((isAdmitted) => {
      if (!isAdmitted() || !isCurrent(document, renderer)) return Promise.resolve(false);
      return resolveDependencies().commitShape({
        mode,
        shape,
        featherRadius,
        antiAlias,
        provenance: operation,
      });
    });
  };

  const moveMany = (
    pointerId: number,
    points: readonly SelectionPoint[],
    repositionDraft = false,
    marqueeModifiers?: { constrainAspect: boolean; fromCenter: boolean },
    constrainTranslation = false
  ): boolean => {
    if (!points.length) return false;
    const point = points[points.length - 1];
    if (translation?.pointerId === pointerId) {
      translation.rawX += point.x - translation.last.x;
      translation.rawY += point.y - translation.last.y;
      translation.last = point;
      let rawX = translation.rawX;
      let rawY = translation.rawY;
      if (constrainTranslation && (rawX || rawY)) {
        const distance = Math.hypot(rawX, rawY);
        const angle = Math.round(Math.atan2(rawY, rawX) / (Math.PI / 4)) * (Math.PI / 4);
        rawX = Math.cos(angle) * distance;
        rawY = Math.sin(angle) * distance;
      }
      const proposedBounds = translateSnapRect(translation.sourceBounds, rawX, rawY);
      const snapContext = resolveDependencies().getSnapContext?.(proposedBounds);
      const snap = snapContext
        ? solveSnap({
            movingBounds: proposedBounds,
            targets: snapContext.targets,
            zoom: snapContext.zoom,
            enabled: snapContext.enabled,
            retainedMatches: translation.snapMatches
          })
        : { offsetX: 0, offsetY: 0, matches: [] as readonly SnapMatch[] };
      translation.snapMatches = snap.matches;
      const nextX = rawX + snap.offsetX;
      const nextY = rawY + snap.offsetY;
      const dx = nextX - translation.x;
      const dy = nextY - translation.y;
      translation.x = nextX;
      translation.y = nextY;
      const operation = createTranslateSelectionOperation(
        translation.document.width,
        translation.document.height,
        translation.x,
        translation.y
      );
      const preview = [...translation.before, operation];
      translation.renderer.setSelectionPreviewProjection(preview, {
        x: translation.x,
        y: translation.y
      });
      resolveDependencies().publishSnapFeedback?.(
        snap.matches,
        translateSnapRect(translation.sourceBounds, translation.x, translation.y)
      );
      return true;
    }
    let gesturePoints = points;
    if (marqueeTool && marqueeTool !== 'select-free' && !repositionDraft) {
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
          retainedMatches: marqueeSnapMatches
        });
        marqueeSnapMatches = snap.matches;
        gesturePoints = [
          ...points.slice(0, -1),
          { ...point, x: point.x + snap.offsetX, y: point.y + snap.offsetY }
        ];
      } else marqueeSnapMatches = [];
    }
    const draft = gesture.moveMany(
      pointerId,
      gesturePoints,
      repositionDraft,
      marqueeModifiers
    );
    if (!draft) return false;
    resolveDependencies().publishDraft(draft);
    if (marqueeTool && marqueeTool !== 'select-free') {
      const xs = draft.points.map(({ x }) => x);
      const ys = draft.points.map(({ y }) => y);
      resolveDependencies().publishSnapFeedback?.(marqueeSnapMatches, {
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
    const operation = createMagicWandSelectionOperation(
      layerId,
      document.revision,
      document.width,
      document.height,
      point,
      options,
      mode
    );
    const generation = magicWandGeneration;
    const onMagicWandCommitted = dependencies.onMagicWandCommitted;
    const cancellation = new AbortController();
    magicWandAborts.add(cancellation);
    try {
      return await queueCommit(async (isAdmitted) => {
        if (!isAdmitted() || generation !== magicWandGeneration || !isCurrent(document, renderer)) return false;
        const latest = resolveDependencies();
        const applied = await latest.commitMagicWand({
          layerId,
          point: { x: point.x, y: point.y },
          mode,
          options: { ...options },
          provenance: operation,
        }, cancellation.signal);
        if (applied && isAdmitted() && generation === magicWandGeneration && isCurrent(document, renderer)) {
          latest.setError(null);
          if (recordObserved) {
            notifyObservedCommit(latest, () => onMagicWandCommitted?.({
              kind: 'magic-wand', layerId,
              point: { x: point.x, y: point.y }, mode, options: { ...options },
            }));
          }
        }
        return applied;
      });
    } finally {
      magicWandAborts.delete(cancellation);
    }
  };

  const runSelectSimilar = async (
    layerId: LayerId,
    options: SimilarSelectionOptions
  ): Promise<boolean> => {
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!document || !renderer || !hasCommittedSelection(dependencies) || !findDocumentLayer(document, layerId)) {
      return false;
    }
    const operation = createSimilarSelectionOperation(
      layerId,
      document.revision,
      document.width,
      document.height,
      options
    );
    return queueCommit(async (isAdmitted) => {
      if (!isAdmitted() || !isCurrent(document, renderer)) return false;
      const applied = await resolveDependencies().commitOperation({ operation });
      if (isAdmitted() && isCurrent(document, renderer)) {
        dependencies.setError(applied ? null : 'Similar colors could not be selected.');
      }
      return applied;
    });
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
    contains: (point) => committedSelectionContainsPoint(resolveDependencies(), point),
    begin: (
      pointerId,
      tool,
      point,
      mode,
      stripSize,
      smooth,
      smoothingScale,
      marqueeOptions,
      rasterOptions
    ) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      const renderer = dependencies.getRenderer();
      if (!document || !renderer) return false;
      const before = cloneSelectionOperations(dependencies.getSelection());
      if (mode === 'replace' && committedSelectionContainsPoint(dependencies, point)) {
        const sourceBounds = dependencies.getSelectionSupportBounds?.()
          ?? selectionOperationsEditingBounds(before, {
            x: 0, y: 0, width: document.width, height: document.height
          });
        translation = {
          pointerId,
          document,
          renderer,
          before,
          last: point,
          sourceBounds,
          x: 0,
          y: 0,
          rawX: 0,
          rawY: 0,
          snapMatches: [],
          stopped: false
        };
        marqueeSnapMatches = [];
        dependencies.publishPointer(pointerId);
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
            enabled: marqueeSnap.enabled
          })
        : { offsetX: 0, offsetY: 0, matches: [] as readonly SnapMatch[] };
      const snappedPoint = { x: point.x + snap.offsetX, y: point.y + snap.offsetY };
      gestureOwner = { document, renderer, onShapeCommitted: dependencies.onShapeCommitted };
      marqueeTool = tool;
      marqueeSnapMatches = snap.matches;
      const draft = gesture.begin(pointerId, tool, snappedPoint, mode, {
        documentWidth: document.width,
        documentHeight: document.height,
        size: stripSize ?? 1
      }, smooth, smoothingScale, marqueeOptions, rasterOptions);
      dependencies.publishDraft(draft);
      dependencies.publishSnapFeedback?.(snap.matches, snap.matches.length ? {
        x: snappedPoint.x, y: snappedPoint.y, width: 0, height: 0
      } : null);
      dependencies.publishPointer(pointerId);
      return true;
    },
    move: (
      pointerId,
      point,
      repositionDraft,
      marqueeModifiers,
      constrainTranslation
    ) => moveMany(
      pointerId,
      [point],
      repositionDraft,
      marqueeModifiers,
      constrainTranslation
    ),
    moveMany,
    finish: (pointerId) => {
      if (translation?.pointerId === pointerId) {
        const current = translation;
        translation = null;
        current.stopped = true;
        const after = current.x || current.y
          ? [...current.before, createTranslateSelectionOperation(
              current.document.width,
              current.document.height,
              current.x,
              current.y
            )]
          : current.before;
        resolveDependencies().publishSnapFeedback?.([], null);
        const latest = resolveDependencies();
        latest.publishPointer(null);
        if (after === current.before) {
          current.renderer.setCommittedSelectionProjection(current.before);
          return true;
        }
        const provenance = after.at(-1)!;
        void queueCommit(async (isAdmitted) => {
          if (!isAdmitted() || !isCurrent(current.document, current.renderer)) return false;
          const applied = await resolveDependencies().commitTranslation({
            x: current.x,
            y: current.y,
            provenance,
          });
          if (!isAdmitted()) return false;
          if (!applied && isCurrent(current.document, current.renderer)) {
            current.renderer.setCommittedSelectionProjection(current.before);
            resolveDependencies().setError('The selection could not be moved.');
          }
          return applied;
        });
        return true;
      }
      const result = gesture.finish(pointerId);
      return applyGestureResult(result);
    },
    cancel: (pointerId) => {
      if (translation?.pointerId === pointerId) {
        const current = translation;
        translation = null;
        current.stopped = true;
        resolveDependencies().publishSnapFeedback?.([], null);
        current.renderer.setCommittedSelectionProjection(current.before);
        const latest = resolveDependencies();
        latest.publishPointer(null);
        return true;
      }
      if (!gesture.cancel(pointerId)) return false;
      gestureOwner = null;
      marqueeTool = null;
      marqueeSnapMatches = [];
      const dependencies = resolveDependencies();
      dependencies.publishDraft(null);
      dependencies.publishSnapFeedback?.([], null);
      dependencies.publishPointer(null);
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
      const document = dependencies.getDocument();
      const renderer = dependencies.getRenderer();
      if (!document || !renderer) return false;
      if (!polygonGesture.active) gestureOwner = { document, renderer, onShapeCommitted: dependencies.onShapeCommitted };
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
      dependencies.publishPointer(null);
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
    selectSimilar: runSelectSimilar,
    rasterMask: async (mask, mode, signal = new AbortController().signal) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      const renderer = dependencies.getRenderer();
      if (!document || !renderer
        || mask.width !== document.width || mask.height !== document.height
        || mask.data.byteLength !== document.width * document.height) return false;
      const documentRevision = document.revision;
      const operation = createObjectSelectionOperation(
        document.revision, document.width, document.height, mode,
      );
      return queueCommit((isAdmitted) => {
        const latest = resolveDependencies();
        const latestDocument = latest.getDocument();
        if (!isAdmitted() || signal.aborted || latest.getRenderer() !== renderer
          || latestDocument?.id !== document.id
          || latestDocument.revision !== documentRevision) return Promise.resolve(false);
        return latest.commitRasterMask({ mask, mode, provenance: operation }, signal);
      });
    },
    beginPaint: (pointerId, point, mode, options) => paint.begin(pointerId, point, mode, options),
    movePaint: (pointerId, points) => paint.move(pointerId, points),
    finishPaint: (pointerId) => paint.finish(pointerId),
    cancelPaint: (pointerId) => paint.cancel(pointerId),
    ownsPaint: (pointerId) => paint.owns(pointerId),
    applyShape,
    finishPolygon: () => (
      polygonGesture.active
        ? applyGestureResult(polygonGesture.finish())
        : false
    ),
    cancelPolygon: () => {
      if (!polygonGesture.cancel()) return false;
      gestureOwner = null;
      const dependencies = resolveDependencies();
      dependencies.publishDraft(null);
      dependencies.publishPointer(null);
      return true;
    },
    retire: () => {
      retirementEpoch += 1;
      magicWandGeneration += 1;
      magicWandAborts.forEach((controller) => controller.abort());
      magicWandAborts.clear();
      if (translation) translation.stopped = true;
      translation = null;
      queuedTranslationSelection = null;
      marqueeTool = null;
      marqueeSnapMatches = [];
      gestureOwner = null;
      gesture.reset();
      polygonGesture.reset();
      paint.retire();
    },
    reset: () => {
      const dependencies = resolveDependencies();
      const interruptedTranslation = translation;
      paint.reset();
      magicWandGeneration += 1;
      magicWandAborts.forEach((controller) => controller.abort());
      magicWandAborts.clear();
      if (interruptedTranslation) interruptedTranslation.stopped = true;
      translation = null;
      marqueeTool = null;
      marqueeSnapMatches = [];
      gestureOwner = null;
      resolveDependencies().publishSnapFeedback?.([], null);
      gesture.reset();
      polygonGesture.reset();
      dependencies.publishDraft(null);
      dependencies.publishPointer(null);
      if (interruptedTranslation) {
        interruptedTranslation.renderer.setCommittedSelectionProjection(interruptedTranslation.before);
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
      if (!hasCommittedSelection(dependencies) && !gesture.draft) return;
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
        if (!hasCommittedSelection(dependencies) && !gesture.draft) return true;
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
      if (!document || !hasCommittedSelection(dependencies)) return Promise.resolve(false);
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
      if (!document || !hasCommittedSelection(dependencies)) return Promise.resolve(false);
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
      if (!document || !hasCommittedSelection(dependencies)) return Promise.resolve(false);
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
      if (!document || !hasCommittedSelection(dependencies)) return Promise.resolve(false);
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
      if (!document || !layer?.mask) return Promise.resolve(false);
      return commitSnapshot(
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
      if (!document || !layer || (layer.type !== 'raster' && layer.type !== 'text' && layer.type !== 'vector')) {
        return Promise.resolve(false);
      }
      return commitSnapshot(
        [createLayerTransparencySelectionOperation(
          layer.id,
          layer.type === 'raster'
            ? `raster:${layer.pixelRevision}`
            : `semantic:${layer.revision}`,
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
    translate: translateSnapshot,
    settle: async () => {
      while (true) {
        const translationTail = translateQueue;
        const commitTail = commitQueue;
        await translationTail;
        await commitTail;
        if (translationTail === translateQueue && commitTail === commitQueue) return;
      }
    }
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
