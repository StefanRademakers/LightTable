import React from 'react';
import type {
  LayerPanelController
} from '../../application/layers/useLayerPanelController';
import type {
  ImageDocument,
  DocumentFontAsset,
  LayerId
} from '../../editor/document/documentTypes';
import type {
  LayerThumbnailSet
} from '../../editor/layers/layerThumbnailTypes';
import type {
  PaintChannel
} from '../../editor/session/editorSession';
import { LayerPanel } from '../../editor/ui/LayerPanel';
import type { TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';

export interface LayersWorkspacePanelProps {
  document: ImageDocument | null;
  availableFonts: readonly DocumentFontAsset[];
  textFontDiagnostics?: readonly TextFontDiagnostic[];
  thumbnails: ReadonlyMap<LayerId, LayerThumbnailSet>;
  activeChannel: PaintChannel;
  isolatedMaskLayerId: LayerId | null;
  onMaskIsolationChange: (layerId: LayerId | null) => void;
  controller: LayerPanelController;
  onSelectionChange?: (layerIds: LayerId[]) => void;
  editingTextLayerId?: LayerId | null;
  onEditText?: (layerId: LayerId) => void;
  onOpenFontReport?: (layerId: LayerId) => void;
}

/**
 * Binds the Layers presentation to its document-scoped command controller.
 *
 * Panel placement (docked, floating or a future desktop window) must not
 * acquire a second layer-mutation path.
 */
export const LayersWorkspacePanel: React.FC<LayersWorkspacePanelProps> = ({
  document,
  availableFonts,
  textFontDiagnostics,
  thumbnails,
  activeChannel,
  isolatedMaskLayerId,
  onMaskIsolationChange,
  controller,
  onSelectionChange,
  editingTextLayerId,
  onEditText,
  onOpenFontReport
}) => {
  if (!document) {
    return (
      <div className="lighttable-layers-panel lighttable-layers-panel--empty">
        No document layers
      </div>
    );
  }

  return (
    <div className="lighttable-layers-panel">
      <LayerPanel
        document={document}
        availableFonts={availableFonts}
        textFontDiagnostics={textFontDiagnostics}
        thumbnails={thumbnails}
        activeChannel={activeChannel}
        isolatedMaskLayerId={isolatedMaskLayerId}
        onMaskIsolationChange={onMaskIsolationChange}
        onSelect={controller.select}
        onChannelChange={controller.changeChannel}
        onVisibility={controller.setVisibility}
        onRename={controller.rename}
        onOpacity={controller.setOpacity}
        onVectorAntiAlias={controller.setVectorAntiAlias}
        onFillOpacity={controller.setFillOpacity}
        onOpacityInteractionStart={controller.beginOpacityInteraction}
        onOpacityInteractionEnd={controller.endOpacityInteraction}
        onBlendMode={controller.setBlendMode}
        onClipping={controller.setClipping}
        onReorder={controller.reorder}
        onAddMask={controller.addMask}
        onLoadMaskSelection={controller.loadMaskSelection}
        onToggleMask={controller.toggleMask}
        onRemoveMask={controller.removeMask}
        onLockChange={controller.setLock}
        onCreate={controller.createRasterLayer}
        onCreateAdjustment={controller.createAdjustmentLayer}
        onCreateLensFx={controller.createLensFxLayer}
        onCreateGroup={controller.createGroup}
        onGroupSelection={controller.groupSelection}
        onUngroupSelection={controller.ungroupSelection}
        onDelete={controller.deleteSelection}
        onDuplicate={controller.duplicateActive}
        onRasterizeText={controller.rasterizeActiveText}
        onMergeDown={controller.mergeDown}
        onMergeSelected={controller.mergeSelected}
        onFlattenGroup={controller.flattenGroup}
        onFlattenImage={controller.flattenImage}
        onEditStyles={controller.editStyles}
        onStyleStackEnabled={controller.setStyleStackEnabled}
        onLocalGradeEnabled={controller.setLocalGradeEnabled}
        onLocalLensFxEnabled={controller.setLocalLensFxEnabled}
        onStyleEnabled={controller.setStyleEnabled}
        onClearStyles={controller.clearStyles}
        onSelectionChange={onSelectionChange}
        editingTextLayerId={editingTextLayerId}
        onEditText={onEditText}
        onOpenFontReport={onOpenFontReport}
      />
    </div>
  );
};
