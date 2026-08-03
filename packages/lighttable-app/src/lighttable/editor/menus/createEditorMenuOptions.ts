import type { ContextMenuOption } from '../../../ui/ContextMenu';
import type { BlendMode } from '../document/blendModes';

export type EditorMenuId = 'file' | 'edit' | 'select' | 'layer' | 'type' | 'view';

export interface EditorMenuLayerState {
  type: 'raster' | 'group' | 'adjustment' | 'vector' | 'text';
  hasMask: boolean;
  maskEnabled: boolean;
  visible: boolean;
  locked: boolean;
  clipping: boolean;
  activeIndex: number;
  siblingCount: number;
  belowIsRaster: boolean;
  canFlattenGroup: boolean;
  canDelete: boolean;
}

export interface EditorMenuState {
  saving: boolean;
  hasDocument: boolean;
  hasMetadata: boolean;
  hasSourceKey: boolean;
  hasCompatibilityReport: boolean;
  copiedGradeName: string | null;
  hasSelection: boolean;
  selectionClipboardAvailable: boolean;
  activeChannel: 'pixels' | 'mask';
  layer: EditorMenuLayerState | null;
  rasterLayerCount: number;
  layerCount: number;
  canFlattenImage: boolean;
  autoAlignPreview: boolean;
  autoAlignAvailable: boolean;
  zoomMode: 'fit' | '100' | 'custom';
  showOriginal: boolean;
  showDifference: boolean;
  blendModes: Array<{ id: BlendMode; label: string; selected: boolean; separatorBefore: boolean }>;
}

export interface EditorMenuLabels {
  primaryShortcut: (key: string, shift?: boolean) => string;
}

export interface EditorMenuCommands {
  newDocument: () => void;
  open: () => void;
  save: () => void;
  exportPng: () => void;
  pdfExportPreflight: () => void;
  openCompatibilityReport: () => void;
  copySelectedContent: () => void;
  copyMergedContent: () => void;
  pasteSelectedContent: () => void;
  pasteGrade: () => void;
  copyGrade: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  invertSelection: () => void;
  featherSelection: () => void;
  createRasterLayer: () => void;
  duplicateLayer: () => void;
  rasterizeText: () => void;
  convertTextToShape: () => void;
  layerViaCopy: () => void;
  renameLayer: () => void;
  invertLayerColors: () => void;
  beginAutoAlign: () => void;
  applyAutoAlign: () => void;
  cancelAutoAlign: () => void;
  toggleClipping: () => void;
  setBlendMode: (mode: BlendMode) => void;
  editPixels: () => void;
  editMask: () => void;
  addMask: () => void;
  toggleMask: () => void;
  removeMask: () => void;
  moveLayerUp: () => void;
  moveLayerDown: () => void;
  mergeDown: () => void;
  flattenGroup: () => void;
  flattenImage: () => void;
  toggleLayerVisibility: () => void;
  toggleLayerLock: () => void;
  deleteLayer: () => void;
  fit: () => void;
  actualSize: () => void;
  toggleOriginal: () => void;
  toggleDifference: () => void;
  toggleScreenMode: () => void;
  showDebugPanel: () => void;
  resetWorkspaceLayout: () => void;
}

const checkedLabel = (label: string, checked: boolean) => checked ? `${label} ✓` : label;

export const createEditorMenuOptions = (
  menu: EditorMenuId,
  state: EditorMenuState,
  labels: EditorMenuLabels,
  commands: EditorMenuCommands
): Array<ContextMenuOption<string>> => {
  const layer = state.layer;

  if (menu === 'file') {
    return [
      {
        value: 'new-document',
        label: 'New',
        shortcut: labels.primaryShortcut('N'),
        onClick: commands.newDocument,
        disabled: state.saving
      },
      {
        value: 'open-image',
        label: 'Open',
        shortcut: labels.primaryShortcut('O'),
        onClick: commands.open,
        disabled: state.saving
      },
      {
        value: 'save-corrected',
        label: state.saving ? 'Saving...' : 'Save LightTable',
        shortcut: labels.primaryShortcut('S'),
        onClick: commands.save,
        disabled: !state.hasMetadata || !state.hasSourceKey || state.saving
      },
      {
        value: 'export-png',
        label: 'Quick Export PNG',
        shortcut: labels.primaryShortcut('S', true),
        onClick: commands.exportPng,
        disabled: !state.hasMetadata || state.saving
      },
      {
        value: 'pdf-export-preflight',
        label: 'PDF Export Preflight...',
        separatorBefore: true,
        onClick: commands.pdfExportPreflight,
        disabled: !state.hasDocument || state.saving
      },
      {
        value: 'document-compatibility-report',
        label: 'Document Compatibility Report...',
        onClick: commands.openCompatibilityReport,
        disabled: !state.hasCompatibilityReport || state.saving
      }
    ];
  }

  if (menu === 'edit') {
    return [
      {
        value: 'copy-selected-content',
        label: 'Copy',
        shortcut: labels.primaryShortcut('C'),
        onClick: commands.copySelectedContent,
        disabled: !state.hasMetadata || !state.hasSelection || state.saving
      },
      {
        value: 'copy-merged-content',
        label: 'Copy Merged',
        shortcut: labels.primaryShortcut('C', true),
        onClick: commands.copyMergedContent,
        disabled: !state.hasMetadata || !state.hasSelection || state.saving
      },
      {
        value: 'paste-selected-content',
        label: 'Paste as new layer',
        shortcut: labels.primaryShortcut('V'),
        onClick: commands.pasteSelectedContent,
        disabled: !state.hasMetadata || state.saving
      },
      {
        value: 'paste-grade',
        label: state.copiedGradeName ? `Paste grade: ${state.copiedGradeName}` : 'Paste grade',
        separatorBefore: true,
        onClick: commands.pasteGrade,
        disabled: !state.hasMetadata || !state.copiedGradeName || state.saving
      },
      {
        value: 'copy-grade',
        label: 'Copy grade',
        onClick: commands.copyGrade,
        disabled: !state.hasMetadata || state.saving
      }
    ];
  }

  if (menu === 'select') {
    return [
      {
        value: 'select-all',
        label: 'Select all',
        shortcut: labels.primaryShortcut('A'),
        onClick: commands.selectAll,
        disabled: !state.hasMetadata || state.saving
      },
      {
        value: 'select-none',
        label: 'Select none',
        shortcut: labels.primaryShortcut('D'),
        onClick: commands.clearSelection,
        disabled: !state.hasSelection || state.saving
      },
      {
        value: 'invert-selection',
        label: 'Invert selection',
        shortcut: labels.primaryShortcut('I', true),
        onClick: commands.invertSelection,
        disabled: !state.hasMetadata || state.saving
      },
      {
        value: 'clear-selection',
        label: 'Clear selection',
        shortcut: labels.primaryShortcut('D'),
        onClick: commands.clearSelection,
        disabled: !state.hasSelection || state.saving
      },
      {
        value: 'feather-selection',
        label: 'Feather...',
        shortcut: 'Shift+F6',
        separatorBefore: true,
        onClick: commands.featherSelection,
        disabled: !state.hasSelection || state.saving
      }
    ];
  }

  if (menu === 'layer') {
    return [
      {
        value: 'new-layer',
        label: 'New Raster Layer',
        onClick: commands.createRasterLayer,
        disabled: !state.hasDocument
      },
      {
        value: 'duplicate-layer',
        label: 'Duplicate Layer',
        onClick: commands.duplicateLayer,
        disabled: !layer || (layer.type !== 'raster' && layer.type !== 'text')
      },
      ...(layer?.type === 'text' ? [{
        value: 'convert-text-to-shape',
        label: 'Convert to Shape...',
        onClick: commands.convertTextToShape,
        disabled: layer.locked
      }, {
        value: 'rasterize-text',
        label: 'Rasterize Type',
        onClick: commands.rasterizeText
      }] : []),
      {
        value: 'layer-via-copy',
        label: 'Layer via Copy',
        shortcut: labels.primaryShortcut('J'),
        onClick: commands.layerViaCopy,
        disabled: !layer || layer.type !== 'raster' || state.saving
      },
      {
        value: 'rename-layer',
        label: 'Rename Layer',
        onClick: commands.renameLayer,
        disabled: !layer
      },
      {
        value: 'invert-layer-colors',
        label: 'Invert Colors',
        shortcut: labels.primaryShortcut('I'),
        separatorBefore: true,
        onClick: commands.invertLayerColors,
        disabled: !layer || layer.type !== 'raster' || layer.locked
      },
      ...(state.autoAlignPreview ? [
        {
          value: 'apply-auto-align',
          label: 'Apply Auto Align',
          separatorBefore: true,
          onClick: commands.applyAutoAlign
        },
        {
          value: 'cancel-auto-align',
          label: 'Cancel Auto Align',
          onClick: commands.cancelAutoAlign
        }
      ] : [{
        value: 'auto-align',
        label: 'Auto Align to Locked Layer',
        separatorBefore: true,
        onClick: commands.beginAutoAlign,
        disabled: !state.autoAlignAvailable
      }]),
      {
        value: 'clipping-mask',
        label: layer?.clipping ? 'Release Clipping Mask' : 'Create Clipping Mask',
        separatorBefore: true,
        onClick: commands.toggleClipping,
        disabled: !layer || (!layer.clipping && layer.activeIndex <= 0)
      },
      {
        value: 'blend-mode',
        label: 'Blend Mode',
        disabled: !layer,
        children: state.blendModes.map((mode) => ({
          value: `blend-${mode.id}`,
          label: checkedLabel(mode.label, mode.selected),
          separatorBefore: mode.separatorBefore,
          onClick: () => commands.setBlendMode(mode.id)
        }))
      },
      {
        value: 'edit-layer-pixels',
        label: checkedLabel('Edit Layer Pixels', state.activeChannel === 'pixels'),
        onClick: commands.editPixels,
        disabled: !layer || layer.type !== 'raster'
      },
      {
        value: 'edit-layer-mask',
        label: checkedLabel('Edit Layer Mask', state.activeChannel === 'mask'),
        onClick: commands.editMask,
        disabled: !layer?.hasMask
      },
      {
        value: 'add-mask',
        label: 'Add Layer Mask',
        separatorBefore: true,
        onClick: commands.addMask,
        disabled: !layer || layer.type === 'group' || layer.hasMask
      },
      {
        value: 'toggle-mask',
        label: layer?.maskEnabled ? 'Disable Layer Mask' : 'Enable Layer Mask',
        onClick: commands.toggleMask,
        disabled: !layer?.hasMask
      },
      {
        value: 'remove-mask',
        label: 'Remove Layer Mask',
        onClick: commands.removeMask,
        disabled: !layer?.hasMask
      },
      {
        value: 'move-up',
        label: 'Move Layer Up',
        separatorBefore: true,
        onClick: commands.moveLayerUp,
        disabled: !layer || layer.activeIndex >= layer.siblingCount - 1
      },
      {
        value: 'move-down',
        label: 'Move Layer Down',
        onClick: commands.moveLayerDown,
        disabled: !layer || layer.activeIndex <= 0
      },
      {
        value: 'merge-down',
        label: 'Merge Down',
        shortcut: labels.primaryShortcut('E'),
        onClick: commands.mergeDown,
        disabled: !layer || layer.type !== 'raster' || layer.activeIndex <= 0 || !layer.belowIsRaster
      },
      {
        value: 'flatten-group',
        label: 'Flatten Group...',
        onClick: commands.flattenGroup,
        disabled: !layer || layer.type !== 'group' || !layer.canFlattenGroup
      },
      {
        value: 'flatten-image',
        label: 'Flatten Image...',
        onClick: commands.flattenImage,
        disabled: !state.canFlattenImage
      },
      {
        value: 'toggle-visibility',
        label: layer?.visible ? 'Hide Layer' : 'Show Layer',
        separatorBefore: true,
        onClick: commands.toggleLayerVisibility,
        disabled: !layer
      },
      {
        value: 'toggle-lock',
        label: layer?.locked ? 'Unlock Layer' : 'Lock Layer',
        onClick: commands.toggleLayerLock,
        disabled: !layer
      },
      {
        value: 'delete-layer',
        label: 'Delete Layer',
        separatorBefore: true,
        onClick: commands.deleteLayer,
        disabled: !layer?.canDelete
      }
    ];
  }

  if (menu === 'type') {
    return [{
      value: 'convert-text-to-shape',
      label: 'Convert to Shape...',
      onClick: commands.convertTextToShape,
      disabled: !layer || layer.type !== 'text' || layer.locked
    }];
  }

  return [
    {
      value: 'fit',
      label: state.zoomMode === 'fit' ? 'Fit (current)' : 'Fit',
      onClick: commands.fit,
      disabled: !state.hasMetadata
    },
    {
      value: 'actual-size',
      label: state.zoomMode === '100' ? '100% (current)' : '100%',
      onClick: commands.actualSize,
      disabled: !state.hasMetadata
    },
    {
      value: 'show-original',
      label: state.showOriginal ? 'Show corrected' : 'Show original',
      separatorBefore: true,
      onClick: commands.toggleOriginal,
      disabled: !state.hasMetadata
    },
    {
      value: 'show-difference',
      label: state.showDifference ? 'Show corrected' : 'Show reference difference',
      onClick: commands.toggleDifference,
      disabled: !state.hasMetadata
    },
    {
      value: 'show-debug-panel',
      label: 'Debug panel',
      separatorBefore: true,
      onClick: commands.showDebugPanel
    },
    {
      value: 'toggle-screen-mode',
      label: 'Toggle screen mode',
      shortcut: 'F',
      separatorBefore: true,
      onClick: commands.toggleScreenMode
    },
    {
      value: 'reset-workspace-layout',
      label: 'Reset workspace layout',
      onClick: commands.resetWorkspaceLayout
    }
  ];
};
