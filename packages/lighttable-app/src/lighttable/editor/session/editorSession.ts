import type { SelectionOperation, SelectionToolId } from '../selection/selectionTypes';
import type { WarpToolSettings } from '../../effects/warp/warpTypes';
import type { PathSelectionTarget } from '@lighttable/vector-core';
import type { LayerId } from '../document/documentTypes';

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

export interface VectorPathSelectionReference {
  layerId: LayerId;
  pathId: string;
}

export interface VectorAnchorSelectionReference extends VectorPathSelectionReference {
  subpathId: string;
  anchorId: string;
}

export interface VectorActiveSelectionTarget extends VectorPathSelectionReference {
  target: PathSelectionTarget;
}

/**
 * Transient vector editing state for one document tab.
 *
 * References are fully scene-scoped. Path and anchor ids are only required to
 * be stable inside their owning vector layer, so storing an unscoped path id
 * here would make multi-document and nested-layer editing ambiguous.
 */
export interface VectorEditorSelection {
  paths: VectorPathSelectionReference[];
  anchors: VectorAnchorSelectionReference[];
  active: VectorActiveSelectionTarget | null;
}

export const createVectorEditorSelection = (): VectorEditorSelection => ({
  paths: [],
  anchors: [],
  active: null
});

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
  vectorSelection: VectorEditorSelection;
  selectionPixelSnap: boolean;
  brush: BrushSettings;
  warp: WarpToolSettings;
}

export const createEditorSession = (): EditorSession => ({
  activeTool: 'view',
  pointerId: null,
  activeChannel: 'pixels',
  selection: [],
  vectorSelection: createVectorEditorSelection(),
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
    debugView: 'result',
    diameterPx: 200,
    strength: 0.35,
    hardness: 0.75,
    flow: 0.5,
    spacing: 0.1,
    pressureSize: true,
    pressureStrength: true
  }
});
