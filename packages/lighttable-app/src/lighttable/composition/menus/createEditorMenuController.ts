import type { Dispatch, SetStateAction } from 'react';
import type { LayerPanelController } from '../../application/layers/useLayerPanelController';
import type { EditorDialogController } from '../../editor/ui/useEditorDialogController';
import {
  createEditorMenuOptions,
  type EditorMenuId,
  type EditorMenuLabels
} from '../../editor/menus/createEditorMenuOptions';
import {
  projectEditorMenuState,
  type EditorMenuProjectionInput
} from '../../editor/menus/projectEditorMenuState';
import { findDocumentLayer } from '../../editor/document/layerTree';
import type { LightTableViewState } from '../../types';

export interface EditorMenuControllerOptions {
  readonly projection: EditorMenuProjectionInput;
  readonly labels: EditorMenuLabels;
  readonly file: {
    newDocument(): void;
    open(): void;
    save(): void;
    exportPng(): void;
    pdfExportPreflight(): void;
    openCompatibilityReport(): void;
    openFormatSupport(): void;
  };
  readonly edit: {
    copySelectedContent(): void;
    copyMergedContent(): void;
    pasteSelectedContent(): void;
    pasteGrade(): void;
    copyGrade(): void;
  };
  readonly selection: {
    selectAll(): void;
    clear(): void;
    invert(): void;
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
    setShowOriginal: Dispatch<SetStateAction<boolean>>;
    setShowDifference: Dispatch<SetStateAction<boolean>>;
  };
  readonly workspace: {
    showDebugPanel(): void;
    toggleScreenMode(): void;
    resetLayout(): void;
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
  file,
  edit,
  selection,
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

  const optionsFor = (menuId: EditorMenuId) => createEditorMenuOptions(
    menuId,
    state,
    labels,
    {
      newDocument: file.newDocument,
      open: file.open,
      save: file.save,
      exportPng: file.exportPng,
      pdfExportPreflight: file.pdfExportPreflight,
      openCompatibilityReport: file.openCompatibilityReport,
      openFormatSupport: file.openFormatSupport,
      copySelectedContent: edit.copySelectedContent,
      copyMergedContent: edit.copyMergedContent,
      pasteSelectedContent: edit.pasteSelectedContent,
      pasteGrade: edit.pasteGrade,
      copyGrade: edit.copyGrade,
      selectAll: selection.selectAll,
      clearSelection: selection.clear,
      invertSelection: selection.invert,
      featherSelection: dialogs.openFeather,
      createRasterLayer: layers.panel.createRasterLayer,
      duplicateLayer: layers.duplicate,
      rasterizeText: layers.rasterizeText,
      convertTextToShape: layers.convertTextToShape,
      layerViaCopy: layers.layerViaCopy,
      renameLayer: layers.rename,
      invertLayerColors: layers.invertColors,
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
          dialogs.requestFlatten({
            kind: 'group',
            groupId: activeLayer.id
          });
        }
      },
      flattenImage: () => dialogs.requestFlatten({ kind: 'image' }),
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
      toggleOriginal: () => {
        viewport.setShowDifference(false);
        viewport.setShowOriginal((current) => !current);
      },
      toggleDifference: () => {
        viewport.setShowOriginal(false);
        viewport.setShowDifference((current) => !current);
      },
      showDebugPanel: workspace.showDebugPanel,
      toggleScreenMode: workspace.toggleScreenMode,
      resetWorkspaceLayout: workspace.resetLayout
    }
  );

  return { optionsFor };
};
