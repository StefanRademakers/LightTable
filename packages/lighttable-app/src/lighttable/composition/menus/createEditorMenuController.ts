import type { Dispatch, SetStateAction } from 'react';
import type { LayerPanelController } from '../../application/layers/useLayerPanelController';
import type { EditorDialogController } from '../../editor/ui/useEditorDialogController';
import {
  createEditorMenuOptions,
  type EditorMenuId,
  type EditorAiProviderState,
  type EditorMenuLabels
} from '../../editor/menus/createEditorMenuOptions';
import {
  projectEditorMenuState,
  type EditorMenuProjectionInput
} from '../../editor/menus/projectEditorMenuState';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { LightTableViewState } from '../../types';
import type { LightTableProjectSummary, LightTableRecentFile, LightTableRecentProject } from '../../../platform/LightTableHost';
import type { SnapSettings } from '../../application/tools/snapping/snapSettings';
import type { AdjustmentLayerKind } from '../../processing/adjustmentLayerCatalog';
import type { DocumentGeometryRequest } from '../../application/documentGeometry/documentGeometryModel';
import type { FixedTransformOperation } from '../../application/tools/transform/useTransformSessionController';

export interface EditorMenuControllerOptions {
  readonly projection: EditorMenuProjectionInput;
  readonly labels: EditorMenuLabels;
  readonly aiProviders?: EditorAiProviderState;
  readonly file: {
    newDocument(): void;
    open(): void;
    place(): void;
    importSvg(): void;
    recentFiles: readonly LightTableRecentFile[];
    openRecent(id: string): void;
    clearRecent(): void;
    projectsAvailable?: boolean;
    activeProject?: LightTableProjectSummary | null;
    recentProjects?: readonly LightTableRecentProject[];
    newProject?(): void;
    openProject?(): void;
    openRecentProject?(recentId: string): void;
    clearRecentProjects?(): void;
    closeProject?(): void;
    exitApplication?(): void;
    save(): void;
    exportPng(): void;
    exportJpeg(): void;
    exportWebp(): void;
    exportTiff(): void;
    exportPsd(): void;
    exportPsdMaximumAppearance(): void;
    exportSvg(): void;
    pdfExportPreflight(): void;
    openFormatSupport(): void;
  };
  readonly edit: {
    copySelectedContent(): void;
    copyMergedContent(): void;
    pasteSelectedContent(): void;
    pasteGrade(): void;
    copyGrade(): void;
    applyFixedTransform(operation: FixedTransformOperation): void;
  };
  readonly selection: {
    selectAll(): void;
    clear(): void;
    invert(): void;
    removeObject(): void;
    removeBackground(): void;
  };
  readonly image: {
    openSize(): void;
    openCanvasSize(): void;
    openArbitraryRotation(): void;
    applyDocumentGeometry(request: DocumentGeometryRequest): void;
    beginCrop(): void;
    duplicate(): void;
    applyCurves(): void;
    applyAdjustment?(kind: AdjustmentLayerKind): void;
    assignSrgbProfile?(): void;
  };
  readonly layers: {
    panel: LayerPanelController;
    duplicate(): void;
    rasterizeText(): void;
    convertTextToShape(): void;
    layerViaCopy(): void;
    rename(): void;
    invertColors(): void;
    mergeDown(): void;
  };
  readonly autoAlign: {
    begin(): void;
    apply(): void;
    cancel(): void;
  };
  readonly dialogs: EditorDialogController;
  readonly viewport: {
    setZoomMode(mode: 'fit' | '100' | 'custom'): void;
    setView: Dispatch<SetStateAction<LightTableViewState>>;
    fit?(): void;
    actualSize?(): void;
    setShowDifference: Dispatch<SetStateAction<boolean>>;
    snap?: SnapSettings;
    setSnap?: Dispatch<SetStateAction<SnapSettings>>;
    newGuide?(): void;
    clearGuides?(): void;
  };
  readonly workspace: {
    showDebugPanel(): void;
    showActionsPanel(): void;
    showGenAiPanel(): void;
    showAiHistoryPanel?(): void;
    connectOpenArtProvider?(): void;
    disconnectOpenArtProvider?(): void;
    openStyleGuide?(): void;
    toggleScreenMode(): void;
    resetLayout(): void;
    applyPhotoEditWorkspace(): void;
    applyGradingWorkspace(): void;
    applyAiGenerationWorkspace(): void;
    startGuidedSample?(): void;
    openSettings?(): void;
  };
}

export interface EditorMenuController {
  optionsFor(menuId: EditorMenuId): ReturnType<typeof createEditorMenuOptions>;
}

/**
 * Projects canonical document capabilities into the application menus and
 * binds them to document-scoped commands.
 *
 * Menu presentation no longer knows how to find an active layer or how a
 * layer operation maps to controller calls. This same controller can back a
 * desktop menu, web menu or future command palette without duplicating those
 * capability checks.
 */
export const createEditorMenuController = ({
  projection,
  labels,
  aiProviders,
  file,
  edit,
  selection,
  image,
  layers,
  autoAlign,
  dialogs,
  viewport,
  workspace
}: EditorMenuControllerOptions): EditorMenuController => {
  const state = projectEditorMenuState(projection);
  const document = projection.document;
  const activeLayer = document
    ? findDocumentLayer(document, document.activeLayerId)
    : null;
  const updateSnap: Dispatch<SetStateAction<SnapSettings>> = viewport.setSnap ?? (() => undefined);

  const optionsFor = (menuId: EditorMenuId) => createEditorMenuOptions(
    menuId,
    state,
    labels,
    {
      newDocument: file.newDocument,
      open: file.open,
      place: file.place,
      importSvg: file.importSvg,
      recentFiles: file.recentFiles,
      openRecent: file.openRecent,
      clearRecent: file.clearRecent,
      projectsAvailable: file.projectsAvailable ?? false,
      activeProject: file.activeProject ?? null,
      recentProjects: file.recentProjects ?? [],
      newProject: file.newProject ?? (() => undefined),
      openProject: file.openProject ?? (() => undefined),
      openRecentProject: file.openRecentProject ?? (() => undefined),
      clearRecentProjects: file.clearRecentProjects ?? (() => undefined),
      closeProject: file.closeProject ?? (() => undefined),
      exitApplication: file.exitApplication,
      save: file.save,
      exportPng: file.exportPng,
      exportJpeg: file.exportJpeg,
      exportWebp: file.exportWebp,
      exportTiff: file.exportTiff,
      exportPsd: file.exportPsd,
      exportPsdMaximumAppearance: file.exportPsdMaximumAppearance,
      exportSvg: file.exportSvg,
      pdfExportPreflight: file.pdfExportPreflight,
      openFormatSupport: file.openFormatSupport,
      copySelectedContent: edit.copySelectedContent,
      copyMergedContent: edit.copyMergedContent,
      pasteSelectedContent: edit.pasteSelectedContent,
      pasteGrade: edit.pasteGrade,
      copyGrade: edit.copyGrade,
      applyFixedTransform: edit.applyFixedTransform,
      selectAll: selection.selectAll,
      clearSelection: selection.clear,
      invertSelection: selection.invert,
      featherSelection: dialogs.openFeather,
      removeObject: selection.removeObject,
      removeBackground: selection.removeBackground,
      createRasterLayer: layers.panel.createRasterLayer,
      duplicateLayer: layers.duplicate,
      rasterizeText: layers.rasterizeText,
      convertTextToShape: layers.convertTextToShape,
      layerViaCopy: layers.layerViaCopy,
      renameLayer: layers.rename,
      invertLayerColors: layers.invertColors,
      applyCurves: image.applyCurves,
      applyAdjustment: image.applyAdjustment ?? ((kind) => {
        if (kind === 'curves') image.applyCurves();
        else layers.panel.createAdjustmentLayerOfKind(kind);
      }),
      openImageSize: image.openSize,
      openCanvasSize: image.openCanvasSize,
      openArbitraryRotation: image.openArbitraryRotation,
      applyDocumentGeometry: image.applyDocumentGeometry,
      beginCrop: image.beginCrop,
      duplicateImage: image.duplicate,
      assignSrgbProfile: image.assignSrgbProfile ?? (() => undefined),
      beginAutoAlign: autoAlign.begin,
      applyAutoAlign: autoAlign.apply,
      cancelAutoAlign: autoAlign.cancel,
      toggleClipping: () => activeLayer
        && layers.panel.setClipping(activeLayer.id, !activeLayer.clipping),
      setBlendMode: (mode) => activeLayer
        && layers.panel.setBlendMode(activeLayer.id, mode),
      editPixels: () => layers.panel.changeChannel('pixels'),
      editMask: () => layers.panel.changeChannel('mask'),
      addMask: layers.panel.addMask,
      toggleMask: layers.panel.toggleMask,
      removeMask: layers.panel.removeMask,
      moveLayerUp: () => layers.panel.moveActive('up'),
      moveLayerDown: () => layers.panel.moveActive('down'),
      mergeDown: layers.mergeDown,
      flattenGroup: () => {
        if (activeLayer?.type === 'group') {
          layers.panel.flattenGroup(activeLayer.id);
        }
      },
      flattenImage: layers.panel.flattenImage,
      toggleLayerVisibility: () => activeLayer
        && layers.panel.setVisibility([activeLayer.id], !activeLayer.visible),
      toggleLayerLock: () => activeLayer
        && layers.panel.setLock(
          [activeLayer.id],
          'all',
          !activeLayer.locks.all
        ),
      deleteLayer: () => activeLayer
        && layers.panel.deleteSelection([activeLayer.id]),
      fit: () => {
        if (viewport.fit) return viewport.fit();
        viewport.setZoomMode('fit');
        viewport.setView({ scale: 1, panX: 0, panY: 0 });
      },
      actualSize: () => {
        if (viewport.actualSize) return viewport.actualSize();
        viewport.setZoomMode('100');
        viewport.setView({ scale: 1, panX: 0, panY: 0 });
      },
      toggleDifference: () => {
        viewport.setShowDifference((current) => !current);
      },
      snap: viewport.snap,
      toggleExtras: () => updateSnap((current) => ({
        ...current,
        extrasVisible: current.extrasVisible === false
      })),
      toggleSnap: () => updateSnap((current) => ({ ...current, enabled: !current.enabled })),
      toggleSnapTarget: (target) => updateSnap((current) => ({
        ...current,
        enabled: true,
        targets: { ...current.targets, [target]: !current.targets[target] }
      })),
      setAllSnapTargets: (enabled) => updateSnap((current) => ({
        ...current,
        enabled: enabled || current.enabled,
        targets: {
          guides: enabled,
          grid: enabled && current.gridVisible,
          layers: enabled,
          documentBounds: enabled
        }
      })),
      toggleSmartGuides: () => updateSnap((current) => ({ ...current, smartGuidesVisible: !current.smartGuidesVisible })),
      toggleGuides: () => updateSnap((current) => ({ ...current, guidesVisible: !current.guidesVisible })),
      toggleGrid: () => updateSnap((current) => ({
        ...current,
        gridVisible: !current.gridVisible,
        targets: current.gridVisible ? { ...current.targets, grid: false } : current.targets
      })),
      toggleRulers: () => updateSnap((current) => ({ ...current, rulersVisible: !current.rulersVisible })),
      newGuide: viewport.newGuide,
      toggleGuideLock: () => updateSnap((current) => ({ ...current, guidesLocked: !current.guidesLocked })),
      clearGuides: viewport.clearGuides,
      showDebugPanel: workspace.showDebugPanel,
      showActionsPanel: workspace.showActionsPanel,
      showGenAiPanel: workspace.showGenAiPanel,
      showAiHistoryPanel: workspace.showAiHistoryPanel,
      connectOpenArtProvider: workspace.connectOpenArtProvider,
      disconnectOpenArtProvider: workspace.disconnectOpenArtProvider,
      openStyleGuide: workspace.openStyleGuide,
      toggleScreenMode: workspace.toggleScreenMode,
      resetWorkspaceLayout: workspace.resetLayout,
      applyPhotoEditWorkspace: workspace.applyPhotoEditWorkspace,
      applyGradingWorkspace: workspace.applyGradingWorkspace,
      applyAiGenerationWorkspace: workspace.applyAiGenerationWorkspace,
      startGuidedSample: workspace.startGuidedSample,
      openSettings: workspace.openSettings,
      openCommandHelp: dialogs.openCommandHelp,
      openThirdPartyLicenses: dialogs.openThirdPartyLicenses,
      openAbout: dialogs.openAbout
    },
    aiProviders
  );

  return { optionsFor };
};
