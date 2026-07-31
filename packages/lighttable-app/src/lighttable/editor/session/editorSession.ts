import type { SelectionOperation, SelectionToolId } from '../selection/selectionTypes';
import type { WarpToolSettings } from '../../effects/warp/warpTypes';

export type ToolId =
  | 'view'
  | 'zoom'
  | 'transform'
  | 'warp'
  | 'fill'
  | 'brush'
  | 'erase'
  | SelectionToolId;
export type PaintChannel = 'pixels' | 'mask';

export interface BrushSettings {
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  spacing: number;
  color: string;
  backgroundColor: string;
}

export interface EditorSession {
  activeTool: ToolId;
  pointerId: number | null;
  activeChannel: PaintChannel;
  selection: SelectionOperation[];
  selectionPixelSnap: boolean;
  brush: BrushSettings;
  warp: WarpToolSettings;
}

export const createEditorSession = (): EditorSession => ({
  activeTool: 'view',
  pointerId: null,
  activeChannel: 'pixels',
  selection: [],
  selectionPixelSnap: true,
  brush: {
    size: 48,
    hardness: 0.75,
    opacity: 1,
    flow: 0.35,
    spacing: 0.05,
    color: '#000000',
    backgroundColor: '#ffffff'
  },
  warp: {
    mode: 'push',
    diameterPx: 200,
    strength: 0.35,
    hardness: 0.75,
    flow: 0.5,
    spacing: 0.1,
    pressureSize: true,
    pressureStrength: true
  }
});
