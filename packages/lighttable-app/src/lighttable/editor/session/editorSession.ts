import type { SelectionOperation, SelectionToolId } from '../selection/selectionTypes';

export type ToolId = 'view' | 'transform' | 'fill' | 'brush' | 'erase' | SelectionToolId;
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
  brush: BrushSettings;
}

export const createEditorSession = (): EditorSession => ({
  activeTool: 'view',
  pointerId: null,
  activeChannel: 'pixels',
  selection: [],
  brush: {
    size: 48,
    hardness: 0.75,
    opacity: 1,
    flow: 0.35,
    spacing: 0.05,
    color: '#000000',
    backgroundColor: '#ffffff'
  }
});
