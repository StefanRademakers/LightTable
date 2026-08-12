import type { ViewportPointerMoveIntent } from '../../application/input/viewportPointerRouter';
import type { SelectionSessionController } from '../../application/tools/selection/useSelectionSessionController';
import type { PaintSessionController } from '../../application/tools/paint/usePaintSessionController';
import type { WarpSessionController } from '../../application/tools/warp/warpSessionController';
import type { ToolId } from '../session/editorSession';
import type { BrushPoint } from '../tools/brush/strokeBuilder';

interface PointerSample extends Pick<
  globalThis.PointerEvent,
  'clientX' | 'clientY' | 'pressure' | 'pointerId' | 'pointerType' | 'tiltX' | 'tiltY' | 'timeStamp'
> {}

interface RouteFreehandPointerMoveOptions {
  intent: ViewportPointerMoveIntent;
  activeTool: ToolId;
  pointerId: number;
  currentPoint: BrushPoint;
  samples: readonly PointerSample[];
  project(sample: PointerSample): BrushPoint | null;
  selection: SelectionSessionController;
  warp: WarpSessionController;
  paint: PaintSessionController;
  snapBypass?: boolean;
}

/**
 * Dispatches one ordered host-input batch without coupling tool controllers to
 * DOM events. Every raw sample survives, while Warp and Free Selection publish
 * only one immutable preview/draft for the complete browser event.
 */
export const routeFreehandPointerMove = ({
  intent,
  activeTool,
  pointerId,
  currentPoint,
  samples,
  project,
  selection,
  warp,
  paint,
  snapBypass = false
}: RouteFreehandPointerMoveOptions): boolean => {
  if (intent === 'selection') {
    if (activeTool !== 'select-free') return selection.move(pointerId, currentPoint, snapBypass);
    const points = samples.map(project).filter((point): point is BrushPoint => Boolean(point));
    return selection.moveMany(pointerId, points, snapBypass);
  }
  if (intent === 'warp') {
    const points = samples.flatMap((sample) => {
      const point = project(sample);
      return point ? [{
        ...point,
        tiltX: sample.tiltX,
        tiltY: sample.tiltY,
        timeMs: sample.timeStamp
      }] : [];
    });
    return warp.moveMany(pointerId, points);
  }
  if (intent !== 'paint') return false;
  let moved = false;
  for (const sample of samples) {
    const point = project(sample);
    if (point && paint.move(pointerId, point)) moved = true;
  }
  return moved;
};
