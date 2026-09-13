import { useEffect, useRef } from 'react';
import type { ToolId } from '../../editor/session/editorSession';
import { isPaintTool } from '../../editor/tools/toolCapabilities';

export interface ToolPreparationRenderer {
  preparePaintTool(): void;
  prepareMagicWandTool(): Promise<void>;
}

export const useRendererToolPreparation = ({
  activeTool,
  sourceReadyId,
  getRenderer,
  reportError
}: {
  readonly activeTool: ToolId;
  readonly sourceReadyId: string | null;
  readonly getRenderer: () => ToolPreparationRenderer | null;
  readonly reportError: (message: string) => void;
}): void => {
  const latest = useRef({ getRenderer, reportError });
  latest.current = { getRenderer, reportError };

  useEffect(() => {
    if (!isPaintTool(activeTool)) return;
    try {
      latest.current.getRenderer()?.preparePaintTool();
    } catch (reason) {
      latest.current.reportError(reason instanceof Error
        ? `The paint engine could not be prepared: ${reason.message}`
        : 'The paint engine could not be prepared.');
    }
  }, [activeTool, sourceReadyId]);

  useEffect(() => {
    if (activeTool !== 'select-magic-wand') return;
    let current = true;
    void latest.current.getRenderer()?.prepareMagicWandTool().catch((reason) => {
      if (!current) return;
      latest.current.reportError(reason instanceof Error
        ? `The Magic Wand engine could not be prepared: ${reason.message}`
        : 'The Magic Wand engine could not be prepared.');
    });
    return () => { current = false; };
  }, [activeTool, sourceReadyId]);
};
