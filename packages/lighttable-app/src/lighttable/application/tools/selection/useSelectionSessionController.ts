import { useMemo, useRef } from 'react';
import type { ImageDocument, LayerId } from '../../../editor/document/documentTypes';
import { findDocumentLayer } from '../../../editor/document/layerTree';
import {
  createFeatherSelectionOperation,
  createCompositeChannelSelectionOperation,
  createFullCanvasSelection,
  createInvertSelectionOperation,
  createLayerMaskSelectionOperation,
  createLayerTransparencySelectionOperation,
  createMagicWandSelectionOperation,
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
  SelectionGestureController
} from '../../../editor/tools/selection/selectionGestureController';
import {
  PolygonalSelectionGestureController
} from '../../../editor/tools/selection/polygonalSelectionGestureController';

export interface SelectionHistoryEntry {
  documentMutation: false;
  undo(): void | Promise<void>;
  redo(): void | Promise<void>;
}

export interface SelectionRendererPort {
  replaceSelection(operations: SelectionOperation[]): Promise<boolean>;
  setSelection(shape: SelectionShape, mode: SelectionMode): Promise<boolean>;
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
    smoothingScale?: number
  ): boolean;
  move(pointerId: number, point: SelectionPoint): boolean;
  moveMany(pointerId: number, points: readonly SelectionPoint[]): boolean;
  finish(pointerId: number): boolean;
  cancel(pointerId: number): boolean;
  polygonClick(
    point: SelectionPoint,
    closeDistance: number,
    mode: SelectionCombineMode,
    forceClose?: boolean,
    timestamp?: number
  ): boolean;
  polygonMove(point: SelectionPoint): boolean;
  finishPolygon(): boolean;
  cancelPolygon(): boolean;
  reset(): void;
  selectAll(): void;
  clear(): void;
  invert(): void;
  feather(radius: number): void;
  selectLayerMask(layerId: LayerId): void;
  selectLayerTransparency(layerId: LayerId): void;
  selectCompositeChannel(channel: CompositeSelectionChannel): void;
  translate(x: number, y: number): void;
  magicWand(point: SelectionPoint, mode: SelectionCombineMode, options: MagicWandOptions): boolean;
  rasterMask(mask: RasterSelectionMask, mode: SelectionCombineMode): boolean;
}

export const cloneSelectionOperations = (
  operations: readonly SelectionOperation[]
): SelectionOperation[] => operations.map((operation) => ({
  mode: operation.mode,
  amount: operation.amount,
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
    if (operation.mode === 'feather') return;
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
  let translation: {
    pointerId: number;
    document: ImageDocument;
    renderer: SelectionRendererPort;
    before: SelectionOperation[];
    last: SelectionPoint;
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
    resolveDependencies().pushHistoryEntry({
      documentMutation: false,
      undo: () => replaceSnapshot(previous, document.id),
      redo: () => replaceSnapshot(next, document.id)
    });
  };

  const commitSnapshot = (
    after: SelectionOperation[],
    failureMessage: string
  ) => {
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    if (!document || !renderer) return;
    const before = cloneSelectionOperations(dependencies.getSelection());
    const snapshot = cloneSelectionOperations(after);
    gesture.reset();
    dependencies.publishDraft(null);
    dependencies.publishSelection(before, null);
    void renderer.replaceSelection(snapshot)
      .then((applied) => {
        if (!applied || !isCurrent(document, renderer)) return;
        const latest = resolveDependencies();
        latest.publishSelection(snapshot, null);
        pushHistory(document, before, snapshot);
        latest.setError(null);
      })
      .catch((reason) => {
        if (!isCurrent(document, renderer)) return;
        resolveDependencies().setError(
          reason instanceof Error ? reason.message : failureMessage
        );
      });
  };

  const applyGestureResult = (
    result: ReturnType<SelectionGestureController['finish']>
  ): boolean => {
    if (!result) return false;
    const dependencies = resolveDependencies();
    const document = dependencies.getDocument();
    const renderer = dependencies.getRenderer();
    dependencies.publishDraft(null);
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
      shape: result.shape
    };
    const after = result.mode === 'replace'
      ? [operation]
      : [...before, operation];
    void renderer.setSelection(result.shape, result.mode)
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
          reason instanceof Error
            ? reason.message
            : 'The selection could not be applied.'
        );
      });
    return true;
  };

  const moveMany = (pointerId: number, points: readonly SelectionPoint[]): boolean => {
    if (!points.length) return false;
    const point = points[points.length - 1];
    if (translation?.pointerId === pointerId) {
      const dx = point.x - translation.last.x;
      const dy = point.y - translation.last.y;
      translation.last = point;
      translation.x += dx;
      translation.y += dy;
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
      return true;
    }
    const draft = gesture.moveMany(pointerId, points);
    if (!draft) return false;
    resolveDependencies().publishDraft(draft);
    return true;
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
    begin: (pointerId, tool, point, mode, stripSize, smooth, smoothingScale) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      const renderer = dependencies.getRenderer();
      if (!document || !renderer) return false;
      const before = cloneSelectionOperations(dependencies.getSelection());
      if (mode === 'replace' && before.length && selectionContainsPoint(before, point)) {
        translation = { pointerId, document, renderer, before, last: point, x: 0, y: 0 };
        dependencies.publishSelection(before, pointerId);
        return true;
      }
      const draft = gesture.begin(pointerId, tool, point, mode, {
        documentWidth: document.width,
        documentHeight: document.height,
        size: stripSize ?? 1
      }, smooth, smoothingScale);
      dependencies.publishDraft(draft);
      dependencies.publishSelection(dependencies.getSelection(), pointerId);
      return true;
    },
    move: (pointerId, point) => moveMany(pointerId, [point]),
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
        return true;
      }
      if (!gesture.cancel(pointerId)) return false;
      const dependencies = resolveDependencies();
      dependencies.publishDraft(null);
      dependencies.publishSelection(dependencies.getSelection(), null);
      return true;
    },
    polygonClick: (point, closeDistance, mode, forceClose = false, timestamp = Date.now()) => {
      const dependencies = resolveDependencies();
      if (!dependencies.getDocument() || !dependencies.getRenderer()) return false;
      const result = polygonGesture.click(
        point,
        mode,
        closeDistance,
        forceClose,
        timestamp
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
      const renderer = dependencies.getRenderer();
      if (!document || !renderer || !document.activeLayerId) return false;
      const before = cloneSelectionOperations(
        pendingMagicWandSnapshot ?? dependencies.getSelection()
      );
      const operation = createMagicWandSelectionOperation(
        document.activeLayerId,
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
      void renderer.applyMagicWand(operation)
        .then((applied) => {
          if (!applied || !isCurrent(document, renderer)) {
            if (requestId === magicWandRequestId && isCurrent(document, renderer)) {
              pendingMagicWandSnapshot = null;
              resolveDependencies().setError('The Magic Wand selection could not be applied.');
            }
            return;
          }
          if (requestId !== magicWandRequestId) {
            if (pendingMagicWandSnapshot) pushHistory(document, before, after);
            return;
          }
          pushHistory(document, before, after);
          const latest = resolveDependencies();
          pendingMagicWandSnapshot = null;
          latest.publishSelection(after, null);
          latest.setError(null);
        })
        .catch((reason) => {
          if (requestId !== magicWandRequestId || !isCurrent(document, renderer)) return;
          pendingMagicWandSnapshot = null;
          resolveDependencies().setError(
            reason instanceof Error ? reason.message : 'The Magic Wand selection could not be applied.'
          );
        });
      return true;
    },
    rasterMask: (mask, mode) => {
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
      void renderer.applyRasterSelection(operation).then((applied) => {
        if (!applied || !isCurrent(document, renderer)) return;
        const latest = resolveDependencies();
        latest.publishSelection(after, null);
        pushHistory(document, before, after);
        latest.setError(null);
      }).catch((reason) => {
        if (!isCurrent(document, renderer)) return;
        resolveDependencies().setError(
          reason instanceof Error ? reason.message : 'The object selection could not be applied.'
        );
      });
      return true;
    },
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
      commitSnapshot(
        createFullCanvasSelection(document.width, document.height),
        'The complete canvas could not be selected.'
      );
    },
    clear: () => {
      const dependencies = resolveDependencies();
      if (!dependencies.getSelection().length && !gesture.draft) return;
      commitSnapshot([], 'The selection could not be cleared.');
    },
    invert: () => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      if (!document) return;
      commitSnapshot(
        [
          ...cloneSelectionOperations(dependencies.getSelection()),
          createInvertSelectionOperation(document.width, document.height)
        ],
        'The selection could not be inverted.'
      );
    },
    feather: (radius) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      if (!document || !dependencies.getSelection().length) return;
      commitSnapshot(
        [
          ...cloneSelectionOperations(dependencies.getSelection()),
          createFeatherSelectionOperation(document.width, document.height, radius)
        ],
        'The selection could not be feathered.'
      );
    },
    selectLayerMask: (layerId) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      const layer = document ? findDocumentLayer(document, layerId) : null;
      if (!document || !layer?.mask) return;
      commitSnapshot(
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
      commitSnapshot(
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
      commitSnapshot(
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
