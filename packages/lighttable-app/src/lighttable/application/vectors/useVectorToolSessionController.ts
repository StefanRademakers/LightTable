import { useEffect, useRef } from 'react';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type {
  EditorSession,
  VectorEditorSelection
} from '../../editor/session/editorSession';
import {
  isVectorEditorTool,
  vectorToolActivation
} from '../../editor/tools/vectorToolCatalog';
import { VectorToolSessionController, type VectorToolSessionOptions
} from './VectorToolSessionController';
import type { VectorElementCreationTransaction } from './VectorDocumentController';
import { vectorStyleFromToolSettings } from './vectorStylePresentation';
import type { DocumentMutationController } from '../documents/useDocumentMutationController';
import type { VectorTransformPreviewBinding } from './VectorTransformPreviewBinding';
import type { VectorRuntimeScope } from './VectorRuntimeBinding';

export interface VectorToolSessionHookOptions {
  readonly document: ImageDocument | null;
  readonly rendererGeneration: number;
  readonly sessionIdentity: object | undefined;
  readonly rendererIdentity: object | null;
  readonly lifecycleIdentity: object;
  readonly getSessionIdentity: () => object | undefined;
  readonly getRendererGeneration: () => number;
  readonly captureScope: () => VectorRuntimeScope;
  readonly getDocument: () => ImageDocument | null;
  readonly getSession: () => EditorSession;
  readonly documentMutations: Pick<DocumentMutationController, 'begin' | 'change'>;
  readonly publishSelection: (selection: VectorEditorSelection) => void;
  readonly captureTransformPreview: () => VectorTransformPreviewBinding | null;
  readonly reportError: (message: string) => void;
  readonly rasterizeShape: (
    transaction: VectorElementCreationTransaction,
    rendererGeneration: number
  ) => Promise<boolean>;
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
export const useVectorToolSessionController = (
  options: VectorToolSessionHookOptions
): VectorToolSessionController => {
  const { document, rendererGeneration, sessionIdentity, rendererIdentity, lifecycleIdentity } = options;
  const { activeTool, gradient, shape } = options.getSession();
  const portsRef = useRef(options);
  portsRef.current = options;

  const controllerRef = useRef<VectorToolSessionController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new VectorToolSessionController({
      getDocument: () => portsRef.current.getDocument(),
      getRendererGeneration: () => portsRef.current.getRendererGeneration(),
      captureRuntime: () => {
        const session = portsRef.current.getSessionIdentity();
        const scope = portsRef.current.captureScope();
        return { isCurrent: () => portsRef.current.getSessionIdentity() === session && scope.isCurrent() };
      },
      documentMutations: {
        begin: (...args) => portsRef.current.documentMutations.begin(...args),
        change: (...args) => portsRef.current.documentMutations.change(...args)
      },
      getSelection: () => portsRef.current.getSession().vectorSelection,
      setSelection: (next) => {
        portsRef.current.publishSelection(next);
      },
      captureTransformPreview: () => portsRef.current.captureTransformPreview(),
      reportError: (message) => portsRef.current.reportError(message)
    }, {
      penStyle: () => vectorStyleFromToolSettings(portsRef.current.getSession().vectorStyle),
      liveShapeStyle: () => vectorStyleFromToolSettings(portsRef.current.getSession().vectorStyle),
      gradientSettings: () => portsRef.current.getSession().gradient,
      requestGradientColorEditor: (endpoint) => portsRef.current.requestGradientColorEditor?.(endpoint),
      rasterizeShape: (transaction, generation) => portsRef.current.rasterizeShape(
        transaction,
        generation
      ),
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
  }, [activeTool, document?.id, rendererGeneration, sessionIdentity, rendererIdentity, lifecycleIdentity, gradient.application, shape.linkedCorners,
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
