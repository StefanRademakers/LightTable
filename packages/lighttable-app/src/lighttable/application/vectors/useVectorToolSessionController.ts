import { useEffect, useRef } from 'react';
import type { VectorStyle } from '@lighttable/vector-core';
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
import { VectorToolSessionController } from './VectorToolSessionController';
import type { VectorElementCreationTransaction } from './VectorDocumentController';

export interface VectorToolSessionHookOptions {
  readonly document: ImageDocument | null;
  readonly selection: VectorEditorSelection;
  readonly activeTool: ToolId;
  readonly foregroundColor: string;
  readonly gradient: EditorSession['gradient'];
  readonly shape: EditorSession['shape'];
  readonly fillColor: string;
  readonly fillEnabled: boolean;
  readonly strokeColor: string;
  readonly strokeEnabled: boolean;
  readonly strokeWidth: number;
  readonly strokeAlignment: VectorToolStyleSettings['strokeAlignment'];
  readonly applyDocumentSnapshot: (document: ImageDocument) => void;
  readonly pushDocumentHistory: (before: ImageDocument, after: ImageDocument) => void;
  readonly publishSelection: (selection: VectorEditorSelection) => void;
  readonly rasterizeShape: (transaction: VectorElementCreationTransaction) => boolean;
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
  fillColor,
  fillEnabled,
  strokeColor,
  strokeEnabled,
  strokeWidth,
  strokeAlignment,
  applyDocumentSnapshot,
  pushDocumentHistory,
  publishSelection,
  rasterizeShape
}: VectorToolSessionHookOptions): VectorToolSessionController => {
  const portsRef = useRef({
    document,
    selection,
    foregroundColor,
    gradient,
    shape,
    activeTool,
    fillColor,
    fillEnabled,
    strokeColor,
    strokeEnabled,
    strokeWidth,
    strokeAlignment,
    applyDocumentSnapshot,
    pushDocumentHistory,
    publishSelection,
    rasterizeShape
  });
  portsRef.current = {
    document,
    selection,
    foregroundColor,
    gradient,
    shape,
    activeTool,
    fillColor,
    fillEnabled,
    strokeColor,
    strokeEnabled,
    strokeWidth,
    strokeAlignment,
    applyDocumentSnapshot,
    pushDocumentHistory,
    publishSelection,
    rasterizeShape
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
      penStyle: (): VectorStyle => ({
        fill: portsRef.current.fillEnabled
          ? { type: 'solid', color: cssHexToLinearRgba(portsRef.current.fillColor) } : null,
        stroke: portsRef.current.strokeEnabled
          ? createStroke(portsRef.current.strokeColor, portsRef.current.strokeWidth,
            portsRef.current.strokeAlignment) : null,
        opacity: 1
      }),
      liveShapeStyle: (): VectorStyle => ({
        fill: portsRef.current.fillEnabled
          ? { type: 'solid', color: cssHexToLinearRgba(portsRef.current.fillColor) } : null,
        stroke: portsRef.current.strokeEnabled
          ? createStroke(portsRef.current.strokeColor, portsRef.current.strokeWidth,
            portsRef.current.strokeAlignment,
            portsRef.current.activeTool === 'shape-line'
              ? portsRef.current.shape.lineStyle : 'solid') : null,
        opacity: 1
      }),
      gradientSettings: () => portsRef.current.gradient,
      rasterizeShape: (transaction) => portsRef.current.rasterizeShape(transaction)
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

const createStroke = (
  color: string,
  width: number,
  alignment: VectorToolStyleSettings['strokeAlignment'],
  lineStyle: EditorSession['shape']['lineStyle'] = 'solid'
): NonNullable<VectorStyle['stroke']> => ({
  paint: { type: 'solid', color: cssHexToLinearRgba(color) },
  width: Math.max(0.1, width),
  alignment,
  cap: 'round',
  join: 'round',
  miterLimit: 4,
  dash: lineStyle === 'dashed' ? [4, 3] : lineStyle === 'dotted' ? [1, 2] : [],
  dashOffset: 0
});

const srgbToLinear = (value: number) => value <= 0.04045
  ? value / 12.92
  : ((value + 0.055) / 1.055) ** 2.4;

const cssHexToLinearRgba = (color: string): [number, number, number, number] => {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  if (!match) return [0, 0, 0, 1];
  return [
    srgbToLinear(Number.parseInt(match[1]!, 16) / 255),
    srgbToLinear(Number.parseInt(match[2]!, 16) / 255),
    srgbToLinear(Number.parseInt(match[3]!, 16) / 255),
    1
  ];
};
