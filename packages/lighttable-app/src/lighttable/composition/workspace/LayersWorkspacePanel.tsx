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
import type { PropertiesInspectorTarget } from '../../application/properties/propertiesInspectorTarget';
import type { LocalProcessingKind } from '../../processing/adjustmentStack';

export interface LayersWorkspacePanelProps {
  document: ImageDocument | null;
  availableFonts: readonly DocumentFontAsset[];
  textFontDiagnostics?: readonly TextFontDiagnostic[];
  thumbnails: ReadonlyMap<LayerId, LayerThumbnailSet>;
  activeChannel: PaintChannel;
  isolatedMaskLayerId: LayerId | null;
  openMaskEditingOnDoubleClick: boolean;
  onMaskIsolationChange: (layerId: LayerId | null) => void;
  controller: LayerPanelController;
  onSelectionChange?: (layerIds: LayerId[]) => void;
  editingTextLayerId?: LayerId | null;
  onEditText?: (layerId: LayerId) => void;
  onOpenFontReport?: (layerId: LayerId) => void;
  onConvertTextToShape: (layerId: LayerId) => void;
  onRemoveBackground: () => void;
  inspectorTarget: PropertiesInspectorTarget;
  onInspectLayer: (layerId: LayerId, channel: PaintChannel) => void;
  onInspectProcessing: (layerId: LayerId, owner: LocalProcessingKind) => void;
  documentProcessingVisibility: Readonly<{ grade: boolean; lensFx: boolean }>;
  onDocumentProcessingVisibility: (owner: 'grade' | 'lens-fx', visible: boolean) => void;
  onInspectDocumentProcessing: (owner: 'grade' | 'lens-fx') => void;
  globalGradeStrength: number;
  globalGradeModified: boolean;
  globalLensFxModified: boolean;
  copiedGradeName: string | null;
  onGlobalGradeStrength: (strength: number) => void;
  onGlobalGradeStrengthInteractionStart: () => void;
  onGlobalGradeStrengthInteractionEnd: () => void;
  onResetGlobalGrade: () => void;
  onResetGlobalLensFx: () => void;
  onCopyGlobalGrade: () => void;
  onPasteGlobalGrade: () => void;
  onInspectAttachedAdjustment: (layerId: LayerId, adjustmentId: string) => void;
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
  openMaskEditingOnDoubleClick,
  onMaskIsolationChange,
  controller,
  onSelectionChange,
  editingTextLayerId,
  onEditText,
  onOpenFontReport,
  onConvertTextToShape,
  onRemoveBackground,
  inspectorTarget,
  onInspectLayer,
  onInspectProcessing,
  documentProcessingVisibility,
  onDocumentProcessingVisibility,
  onInspectDocumentProcessing,
  globalGradeStrength,
  globalGradeModified,
  globalLensFxModified,
  copiedGradeName,
  onGlobalGradeStrength,
  onGlobalGradeStrengthInteractionStart,
  onGlobalGradeStrengthInteractionEnd,
  onResetGlobalGrade,
  onResetGlobalLensFx,
  onCopyGlobalGrade,
  onPasteGlobalGrade,
  onInspectAttachedAdjustment
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
        openMaskEditingOnDoubleClick={openMaskEditingOnDoubleClick}
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
        onLoadTransparencySelection={controller.loadTransparencySelection}
        onToggleMask={controller.toggleMask}
        onMaskLinked={controller.setMaskLinked}
        onRemoveMask={controller.removeMask}
        onLockChange={controller.setLock}
        onCreate={controller.createRasterLayer}
        onCreateAdjustment={controller.createAdjustmentLayer}
        onCreateCurvesAdjustment={controller.createCurvesAdjustmentLayer}
        onCreateLocalProcessing={controller.createLocalProcessing}
        onCreateAdjustmentKind={controller.createAdjustmentLayerOfKind}
        onCreateAttachedAdjustment={controller.createAttachedAdjustment}
        onCreateGroup={controller.createGroup}
        onGroupSelection={controller.groupSelection}
        onUngroupSelection={controller.ungroupSelection}
        onDelete={controller.deleteSelection}
        onDuplicate={controller.duplicateActive}
        onRasterizeText={controller.rasterizeActiveText}
        onConvertTextToShape={onConvertTextToShape}
        onRemoveBackground={onRemoveBackground}
        onMergeDown={controller.mergeDown}
        onMergeSelected={controller.mergeSelected}
        onFlattenGroup={controller.flattenGroup}
        onFlattenImage={controller.flattenImage}
        onEditStyles={controller.editStyles}
        onStyleStackEnabled={controller.setStyleStackEnabled}
        onLocalGradeEnabled={controller.setLocalGradeEnabled}
        onLocalCurvesEnabled={controller.setLocalCurvesEnabled}
        onLocalLensFxEnabled={controller.setLocalLensFxEnabled}
        onRemoveLocalProcessing={controller.removeLocalProcessing}
        onAttachedAdjustmentEnabled={controller.setAttachedAdjustmentEnabled}
        onRemoveAttachedAdjustment={controller.removeAttachedAdjustment}
        onStyleEnabled={controller.setStyleEnabled}
        onRemoveStyle={controller.removeStyle}
        onClearStyles={controller.clearStyles}
        onSelectionChange={onSelectionChange}
        editingTextLayerId={editingTextLayerId}
        onEditText={onEditText}
        onOpenFontReport={onOpenFontReport}
        inspectorTarget={inspectorTarget}
        onInspectLayer={onInspectLayer}
        onInspectProcessing={onInspectProcessing}
        documentProcessingVisibility={documentProcessingVisibility}
        onDocumentProcessingVisibility={onDocumentProcessingVisibility}
        onInspectDocumentProcessing={onInspectDocumentProcessing}
        globalGradeStrength={globalGradeStrength}
        globalGradeModified={globalGradeModified}
        globalLensFxModified={globalLensFxModified}
        copiedGradeName={copiedGradeName}
        onGlobalGradeStrength={onGlobalGradeStrength}
        onGlobalGradeStrengthInteractionStart={onGlobalGradeStrengthInteractionStart}
        onGlobalGradeStrengthInteractionEnd={onGlobalGradeStrengthInteractionEnd}
        onResetGlobalGrade={onResetGlobalGrade}
        onResetGlobalLensFx={onResetGlobalLensFx}
        onCopyGlobalGrade={onCopyGlobalGrade}
        onPasteGlobalGrade={onPasteGlobalGrade}
        onInspectAttachedAdjustment={onInspectAttachedAdjustment}
      />
    </div>
  );
};
