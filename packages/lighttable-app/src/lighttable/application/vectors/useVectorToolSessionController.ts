import { useEffect, useRef } from 'react';
import type { ImageDocument } from '../../editor/document/documentTypes';
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
  readonly applyDocumentSnapshot: (document: ImageDocument) => void;
  readonly pushDocumentHistory: (before: ImageDocument, after: ImageDocument) => void;
  readonly publishSelection: (selection: VectorEditorSelection) => void;
  readonly rasterizeShape: (transaction: VectorElementCreationTransaction) => boolean;
  readonly requestGradientColorEditor?: (endpoint: 'start' | 'end') => void;
  readonly onLiveShapeCommitted?: VectorToolSessionOptions['onLiveShapeCommitted'];
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
  applyDocumentSnapshot,
  pushDocumentHistory,
  publishSelection,
  rasterizeShape,
  requestGradientColorEditor,
  onLiveShapeCommitted
}: VectorToolSessionHookOptions): VectorToolSessionController => {
  const portsRef = useRef({
    document,
    selection,
    foregroundColor,
    gradient,
    shape,
    activeTool,
    style,
    applyDocumentSnapshot,
    pushDocumentHistory,
    publishSelection,
    rasterizeShape,
    requestGradientColorEditor,
    onLiveShapeCommitted
  });
  portsRef.current = {
    document,
    selection,
    foregroundColor,
    gradient,
    shape,
    activeTool,
    style,
    applyDocumentSnapshot,
    pushDocumentHistory,
    publishSelection,
    rasterizeShape,
    requestGradientColorEditor,
    onLiveShapeCommitted
  };

  const controllerRef = useRef<VectorToolSessionController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new VectorToolSessionController({
      getDocument: () => portsRef.current.document,
      applyDocumentSnapshot: (next) => {
        portsRef.current.document = next;
        portsRef.current.applyDocumentSnapshot(next);
      },
      pushDocumentHistory: (before, after) => portsRef.current.pushDocumentHistory(before, after),
      getSelection: () => portsRef.current.selection,
      setSelection: (next) => {
        portsRef.current.selection = next;
        portsRef.current.publishSelection(next);
      }
    }, {
      penStyle: () => vectorStyleFromToolSettings(portsRef.current.style),
      liveShapeStyle: () => vectorStyleFromToolSettings(portsRef.current.style),
      gradientSettings: () => portsRef.current.gradient,
      requestGradientColorEditor: (endpoint) => portsRef.current.requestGradientColorEditor?.(endpoint),
      rasterizeShape: (transaction) => portsRef.current.rasterizeShape(transaction),
      onLiveShapeCommitted: (result) => portsRef.current.onLiveShapeCommitted?.(result)
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
