import { useEffect, useRef } from 'react';
import type { ImageDocument, LayerId, VectorLayer } from '../../editor/document/documentTypes';
import type { AffineMatrix } from '@lighttable/vector-core';
import type { VectorElement } from '@lighttable/vector-core';
import type {
  EditorSession,
  ToolId,
  VectorEditorSelection,
  VectorToolStyleSettings
} from '../../editor/session/editorSession';
import {
  isVectorEditorTool,
  vectorToolActivation
} from '../../editor/tools/vectorToolCatalog';
import { VectorToolSessionController, type VectorToolSessionOptions
} from './VectorToolSessionController';
import type { VectorElementCreationTransaction } from './VectorDocumentController';
import { vectorStyleFromToolSettings } from './vectorStylePresentation';

export interface VectorToolSessionHookOptions {
  readonly document: ImageDocument | null;
  readonly selection: VectorEditorSelection;
  readonly activeTool: ToolId;
  readonly foregroundColor: string;
  readonly gradient: EditorSession['gradient'];
  readonly shape: EditorSession['shape'];
  readonly style: VectorToolStyleSettings;
  readonly previewDocumentSnapshot: (document: ImageDocument) => void;
  readonly discardDocumentPreview: () => void;
  readonly applyDocumentSnapshot: (document: ImageDocument) => void;
  readonly pushDocumentHistory: (before: ImageDocument, after: ImageDocument) => void;
  readonly publishSelection: (selection: VectorEditorSelection) => void;
  readonly setLayerTransformPreview?: (
    layer: VectorLayer,
    matrix: AffineMatrix | null,
    documentOperation?: AffineMatrix | null
  ) => boolean;
  readonly commitLayerTransformPreview?: (
    before: ImageDocument,
    layerId: LayerId,
    matrix: AffineMatrix,
    documentOperation: AffineMatrix
  ) => boolean;
  readonly setElementTransformPreview?: (
    layers: readonly VectorLayer[],
    documentOperation: AffineMatrix | null
  ) => boolean;
  readonly commitElementTransformPreview?: (
    before: ImageDocument,
    elements: readonly { readonly layerId: LayerId; readonly element: VectorElement }[]
  ) => boolean;
  readonly rasterizeShape: (transaction: VectorElementCreationTransaction) => boolean;
  readonly requestGradientColorEditor?: (endpoint: 'start' | 'end') => void;
  readonly onLiveShapeCommitted?: VectorToolSessionOptions['onLiveShapeCommitted'];
  readonly onPenPathCommitted?: VectorToolSessionOptions['onPenPathCommitted'];
  readonly onPathMutationCommitted?: VectorToolSessionOptions['onPathMutationCommitted'];
  readonly onGradientCommitted?: VectorToolSessionOptions['onGradientCommitted'];
}

/**
 * React host for the framework-neutral vector interaction system.
 *
 * Mutable host ports live behind refs so one document tab owns exactly one
 * controller and an in-flight gesture never changes transaction boundary
 * because React published a newer render closure.
 */
export const useVectorToolSessionController = ({
  document,
  selection,
  activeTool,
  foregroundColor,
  gradient,
  shape,
  style,
  previewDocumentSnapshot,
  discardDocumentPreview,
  applyDocumentSnapshot,
  pushDocumentHistory,
  publishSelection,
  setLayerTransformPreview,
  commitLayerTransformPreview,
  setElementTransformPreview,
  commitElementTransformPreview,
  rasterizeShape,
  requestGradientColorEditor,
  onLiveShapeCommitted,
  onPenPathCommitted,
  onPathMutationCommitted,
  onGradientCommitted
}: VectorToolSessionHookOptions): VectorToolSessionController => {
  const portsRef = useRef({
    document,
    selection,
    foregroundColor,
    gradient,
    shape,
    activeTool,
    style,
    previewDocumentSnapshot,
    discardDocumentPreview,
    applyDocumentSnapshot,
    pushDocumentHistory,
    publishSelection,
    setLayerTransformPreview,
    commitLayerTransformPreview,
    setElementTransformPreview,
    commitElementTransformPreview,
    rasterizeShape,
    requestGradientColorEditor,
    onLiveShapeCommitted,
    onPenPathCommitted,
    onPathMutationCommitted,
    onGradientCommitted
  });
  portsRef.current = {
    document,
    selection,
    foregroundColor,
    gradient,
    shape,
    activeTool,
    style,
    previewDocumentSnapshot,
    discardDocumentPreview,
    applyDocumentSnapshot,
    pushDocumentHistory,
    publishSelection,
    setLayerTransformPreview,
    commitLayerTransformPreview,
    setElementTransformPreview,
    commitElementTransformPreview,
    rasterizeShape,
    requestGradientColorEditor,
    onLiveShapeCommitted,
    onPenPathCommitted,
    onPathMutationCommitted,
    onGradientCommitted
  };

  const controllerRef = useRef<VectorToolSessionController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new VectorToolSessionController({
      getDocument: () => portsRef.current.document,
      previewDocumentSnapshot: (next) => {
        portsRef.current.previewDocumentSnapshot(next);
      },
      discardDocumentPreview: () => {
        portsRef.current.discardDocumentPreview();
      },
      applyDocumentSnapshot: (next) => {
        portsRef.current.document = next;
        portsRef.current.applyDocumentSnapshot(next);
      },
      pushDocumentHistory: (before, after) => portsRef.current.pushDocumentHistory(before, after),
      getSelection: () => portsRef.current.selection,
      setSelection: (next) => {
        portsRef.current.selection = next;
        portsRef.current.publishSelection(next);
      },
      setLayerTransformPreview: (layer, matrix, documentOperation) =>
        portsRef.current.setLayerTransformPreview?.(
          layer, matrix, documentOperation
        ) ?? false,
      commitLayerTransformPreview: (before, layerId, matrix, documentOperation) =>
        portsRef.current.commitLayerTransformPreview?.(
          before, layerId, matrix, documentOperation
        ) ?? false,
      setElementTransformPreview: (layers, documentOperation) =>
        portsRef.current.setElementTransformPreview?.(layers, documentOperation) ?? false,
      commitElementTransformPreview: (before, elements) =>
        portsRef.current.commitElementTransformPreview?.(before, elements) ?? false
    }, {
      penStyle: () => vectorStyleFromToolSettings(portsRef.current.style),
      liveShapeStyle: () => vectorStyleFromToolSettings(portsRef.current.style),
      gradientSettings: () => portsRef.current.gradient,
      requestGradientColorEditor: (endpoint) => portsRef.current.requestGradientColorEditor?.(endpoint),
      rasterizeShape: (transaction) => portsRef.current.rasterizeShape(transaction),
      onLiveShapeCommitted: (result) => portsRef.current.onLiveShapeCommitted?.(result),
      onPenPathCommitted: (result) => portsRef.current.onPenPathCommitted?.(result),
      onPathMutationCommitted: (result) => portsRef.current.onPathMutationCommitted?.(result),
      onGradientCommitted: (result) => portsRef.current.onGradientCommitted?.(result)
    });
  }

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (activeTool === 'gradient' && gradient.application === 'pixels') {
      controller.deactivate();
      return;
    }
    if (!isVectorEditorTool(activeTool)) {
      controller.deactivate();
      return;
    }
    const activation = vectorToolActivation(activeTool);
    if (activation.preset) controller.setLiveShapePreset(
      activation.preset.kind === 'rectangle'
        ? {
            ...activation.preset,
            cornerRadii: [...shape.rectangleCornerRadii],
            linkedCorners: shape.linkedCorners
          }
        : activation.preset.kind === 'line'
          ? {
              ...activation.preset,
              startArrow: shape.lineStartArrow ? {
                width: shape.lineArrowWidth, length: shape.lineArrowLength, concavity: 0
              } : null,
              endArrow: shape.lineEndArrow ? {
                width: shape.lineArrowWidth, length: shape.lineArrowLength, concavity: 0
              } : null
            }
          : activation.preset
    );
    controller.activate(activation.mode);
  }, [activeTool, document?.id, gradient.application, shape.linkedCorners,
    shape.rectangleCornerRadii, shape.lineStartArrow, shape.lineEndArrow,
    shape.lineArrowWidth, shape.lineArrowLength]);

  // Delay destruction by one microtask. React development StrictMode performs
  // a synthetic setup/cleanup/setup cycle; the generation guard prevents that
  // rehearsal from disposing the controller reused by the second setup.
  const disposalGenerationRef = useRef(0);
  useEffect(() => {
    disposalGenerationRef.current += 1;
    return () => {
      const generation = ++disposalGenerationRef.current;
      queueMicrotask(() => {
        if (disposalGenerationRef.current === generation) {
          controllerRef.current?.dispose();
          controllerRef.current = null;
        }
      });
    };
  }, []);

  return controllerRef.current;
};
