import type { ImageDocument, LayerId, Rect } from '../../../editor/document/documentTypes';
import type { EditorSession } from '../../../editor/session/editorSession';
import type { SelectionShape } from '../../../editor/selection/selectionTypes';
import { buildLayerSnapTargets } from '../snapping/layerSnapGeometry';
import type { SnapMatch } from '../snapping/snapEngine';

export interface SelectionGestureHostInputs {
  readonly document: ImageDocument | null;
  readonly editor: EditorSession;
  readonly selectedLayerIds: readonly LayerId[];
  readonly scale: number;
}
export interface SelectionGestureProjection {
  updateEditor(update: (current: EditorSession) => EditorSession): void;
  draft(shape: SelectionShape | null): void;
  snapFeedback(matches: readonly SnapMatch[], bounds: Rect | null): void;
}

/** Gesture chrome and snap policy only. Exact committed selection is read, never republished here. */
export class SelectionGestureHostBinding {
  constructor(private readonly read: () => SelectionGestureHostInputs,
    private readonly projection: SelectionGestureProjection, private readonly isCurrent: () => boolean) {}

  getDocument = () => this.isCurrent() ? this.read().document : null;
  getSelection = () => this.isCurrent() ? this.read().editor.selection : [];
  getSelectionMaskSnapshot = () => this.isCurrent() ? this.read().editor.selectionMaskSnapshot : null;
  getSelectionSupportBounds = () => this.isCurrent() ? this.read().editor.selectionSupportBounds : null;
  publishPointer = (pointerId: number | null) => {
    if (!this.isCurrent()) return;
    this.projection.updateEditor(current => !this.isCurrent() || current.pointerId === pointerId
      ? current : { ...current, pointerId });
  };
  publishDraft = (shape: SelectionShape | null) => {
    if (this.isCurrent()) this.projection.draft(shape);
  };
  publishSnapFeedback = (matches: readonly SnapMatch[], bounds: Rect | null) => {
    if (this.isCurrent()) this.projection.snapFeedback(matches, bounds);
  };
  getSnapContext = (movingBounds: Rect) => {
    if (!this.isCurrent()) return { targets: [], zoom: 1, enabled: false };
    const { document, editor: { snap }, selectedLayerIds, scale } = this.read();
    const excludedLayerIds = new Set(selectedLayerIds);
    if (document?.activeLayerId) excludedLayerIds.add(document.activeLayerId);
    return { targets: document ? buildLayerSnapTargets(document, {
      excludedLayerIds, includeCanvas: snap.targets.documentBounds,
      includeLayers: snap.targets.layers, includeGuides: snap.targets.guides,
      includeGrid: snap.targets.grid && snap.gridVisible,
      gridSpacing: snap.gridSpacing / Math.max(1, snap.gridSubdivisions),
      gridOriginX: snap.gridOriginX, gridOriginY: snap.gridOriginY, movingBounds
    }) : [], zoom: scale, enabled: snap.enabled };
  };
}
