import { useMemo, useRef, useSyncExternalStore } from 'react';
import { TemporaryToolController } from '../../editor/tools/temporaryToolController';
import type { ToolId } from '../../editor/session/editorSession';

/** UI projection and renderer-overlay release; the controller owns overrides. */
export const useTemporaryTool = (clearZoomOverlay: () => void) => {
  const latestClear = useRef(clearZoomOverlay);
  latestClear.current = clearZoomOverlay;
  const controls = useMemo(() => {
    const controller = new TemporaryToolController();
    const begin = (tool: ToolId, zoomOut = false) => {
      const wasZoom = controller.activeTool === 'zoom';
      const changed = controller.begin(tool, zoomOut);
      if (changed && wasZoom) latestClear.current();
    };
    const end = (tool?: ToolId) => {
      const wasZoom = controller.activeTool === 'zoom';
      if (controller.end(tool) && wasZoom) latestClear.current();
    };
    return {
      controller,
      beginPan: () => begin('view'),
      beginZoom: (direction: number) => begin('zoom', direction < 0),
      beginErase: () => begin('erase'),
      releasePan: () => end('view'),
      releaseZoom: () => end('zoom'),
      releaseErase: () => end('erase'),
      clear: () => end()
    };
  }, []);
  const snapshot = useSyncExternalStore(controls.controller.subscribe,
    controls.controller.getSnapshot, controls.controller.getSnapshot);
  return { ...controls, snapshot };
};
