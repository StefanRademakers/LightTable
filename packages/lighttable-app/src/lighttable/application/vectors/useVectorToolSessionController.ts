import { useEffect, useRef } from 'react';
import type { VectorStyle } from '@lighttable/vector-core';
import type { ImageDocument } from '../../editor/document/documentTypes';
import type {
  ToolId,
  VectorEditorSelection
} from '../../editor/session/editorSession';
import {
  isVectorEditorTool,
  vectorToolActivation
} from '../../editor/tools/vectorToolCatalog';
import { VectorToolSessionController } from './VectorToolSessionController';

export interface VectorToolSessionHookOptions {
  readonly document: ImageDocument | null;
  readonly selection: VectorEditorSelection;
  readonly activeTool: ToolId;
  readonly foregroundColor: string;
  readonly fillColor: string;
  readonly fillEnabled: boolean;
  readonly strokeColor: string;
  readonly strokeEnabled: boolean;
  readonly strokeWidth: number;
  readonly applyDocumentSnapshot: (document: ImageDocument) => void;
  readonly pushDocumentHistory: (before: ImageDocument, after: ImageDocument) => void;
  readonly publishSelection: (selection: VectorEditorSelection) => void;
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
  fillColor,
  fillEnabled,
  strokeColor,
  strokeEnabled,
  strokeWidth,
  applyDocumentSnapshot,
  pushDocumentHistory,
  publishSelection
}: VectorToolSessionHookOptions): VectorToolSessionController => {
  const portsRef = useRef({
    document,
    selection,
    foregroundColor,
    fillColor,
    fillEnabled,
    strokeColor,
    strokeEnabled,
    strokeWidth,
    applyDocumentSnapshot,
    pushDocumentHistory,
    publishSelection
  });
  portsRef.current = {
    document,
    selection,
    foregroundColor,
    fillColor,
    fillEnabled,
    strokeColor,
    strokeEnabled,
    strokeWidth,
    applyDocumentSnapshot,
    pushDocumentHistory,
    publishSelection
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
          ? createStroke(portsRef.current.strokeColor, portsRef.current.strokeWidth) : null,
        opacity: 1
      }),
      liveShapeStyle: (): VectorStyle => ({
        fill: portsRef.current.fillEnabled
          ? { type: 'solid', color: cssHexToLinearRgba(portsRef.current.fillColor) } : null,
        stroke: portsRef.current.strokeEnabled
          ? createStroke(portsRef.current.strokeColor, portsRef.current.strokeWidth) : null,
        opacity: 1
      })
    });
  }

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (!isVectorEditorTool(activeTool)) {
      controller.deactivate();
      return;
    }
    const activation = vectorToolActivation(activeTool);
    if (activation.preset) controller.setLiveShapePreset(activation.preset);
    controller.activate(activation.mode);
  }, [activeTool, document?.id]);

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

const createStroke = (color: string, width: number): NonNullable<VectorStyle['stroke']> => ({
  paint: { type: 'solid', color: cssHexToLinearRgba(color) },
  width: Math.max(0.1, width),
  cap: 'round',
  join: 'round',
  miterLimit: 4,
  dash: [],
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
