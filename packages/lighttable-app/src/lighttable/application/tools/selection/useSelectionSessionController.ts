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
  type CompositeSelectionChannel,
  type SelectionCombineMode,
  type SelectionMode,
  type SelectionOperation,
  type SelectionPoint,
  type SelectionShape,
  type SelectionToolId
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
    tool: SelectionToolId,
    point: SelectionPoint,
    mode: SelectionCombineMode,
    stripSize?: number
  ): boolean;
  move(pointerId: number, point: SelectionPoint): boolean;
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
}

export const cloneSelectionOperations = (
  operations: readonly SelectionOperation[]
): SelectionOperation[] => operations.map((operation) => ({
  mode: operation.mode,
  amount: operation.amount,
  source: operation.source ? { ...operation.source } : undefined,
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

  return {
    get active() {
      return gesture.pointerId !== null || polygonGesture.active;
    },
    get polygonActive() {
      return polygonGesture.active;
    },
    get draft() {
      return polygonGesture.draft ?? gesture.draft;
    },
    owns: (pointerId) => gesture.owns(pointerId),
    begin: (pointerId, tool, point, mode, stripSize) => {
      const dependencies = resolveDependencies();
      const document = dependencies.getDocument();
      if (!document || !dependencies.getRenderer()) return false;
      const draft = gesture.begin(pointerId, tool, point, mode, {
        documentWidth: document.width,
        documentHeight: document.height,
        size: stripSize ?? 1
      });
      dependencies.publishDraft(draft);
      dependencies.publishSelection(dependencies.getSelection(), pointerId);
      return true;
    },
    move: (pointerId, point) => {
      const draft = gesture.move(pointerId, point);
      if (!draft) return false;
      resolveDependencies().publishDraft(draft);
      return true;
    },
    finish: (pointerId) => {
      const result = gesture.finish(pointerId);
      return applyGestureResult(result);
    },
    cancel: (pointerId) => {
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
      gesture.reset();
      polygonGesture.reset();
      const dependencies = resolveDependencies();
      dependencies.publishDraft(null);
      dependencies.publishSelection(dependencies.getSelection(), null);
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
