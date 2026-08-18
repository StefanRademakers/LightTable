import type { ContextMenuOption } from '../../../ui/ContextMenu';
import type { BlendMode } from '../document/blendModes';
import type { LightTableProjectSummary, LightTableRecentFile, LightTableRecentProject } from '../../../platform/LightTableHost';
import { createDefaultSnapSettings, type SnapSettings } from '../../application/tools/snapping/snapSettings';
import {
  adjustmentLayerMenuDefinitionGroups,
  type AdjustmentLayerKind
} from '../../processing/adjustmentLayerCatalog';
import type { DocumentGeometryRequest } from '../../application/documentGeometry/documentGeometryModel';
import type { FixedTransformOperation } from '../../application/tools/transform/useTransformSessionController';

export type EditorMenuId = 'file' | 'edit' | 'image' | 'select' | 'layer' | 'type' | 'ai' | 'view' | 'help';

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
  showDifference: boolean;
  documentColor?: {
    bitDepth: 8 | 16 | 32;
    profileState: 'assigned' | 'assumed';
  } | null;
  blendModes: Array<{ id: BlendMode; label: string; selected: boolean; separatorBefore: boolean }>;
}

export interface EditorMenuLabels {
  primaryShortcut: (key: string, shift?: boolean) => string;
}

export interface EditorAiProviderState {
  readonly openArt: 'connected' | 'disconnected';
}

export interface EditorMenuCommands {
  newDocument: () => void;
  open: () => void;
  place: () => void;
  recentFiles: readonly LightTableRecentFile[];
  openRecent: (id: string) => void;
  clearRecent: () => void;
  projectsAvailable: boolean;
  activeProject: LightTableProjectSummary | null;
  recentProjects: readonly LightTableRecentProject[];
  newProject: () => void;
  openProject: () => void;
  openRecentProject: (recentId: string) => void;
  clearRecentProjects: () => void;
  closeProject: () => void;
  save: () => void;
  exportPng: () => void;
  exportJpeg: () => void;
  exportPsd: () => void;
  pdfExportPreflight: () => void;
  openFormatSupport: () => void;
  copySelectedContent: () => void;
  copyMergedContent: () => void;
  pasteSelectedContent: () => void;
  pasteGrade: () => void;
  applyFixedTransform: (operation: FixedTransformOperation) => void;
  copyGrade: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  invertSelection: () => void;
  featherSelection: () => void;
  removeObject: () => void;
  removeBackground: () => void;
  createRasterLayer: () => void;
  duplicateLayer: () => void;
  rasterizeText: () => void;
  convertTextToShape: () => void;
  layerViaCopy: () => void;
  renameLayer: () => void;
  invertLayerColors: () => void;
  applyCurves: () => void;
  applyAdjustment: (kind: AdjustmentLayerKind) => void;
  openImageSize: () => void;
  openCanvasSize: () => void;
  openArbitraryRotation: () => void;
  applyDocumentGeometry: (request: DocumentGeometryRequest) => void;
  beginCrop: () => void;
  duplicateImage: () => void;
  assignSrgbProfile: () => void;
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
  toggleDifference: () => void;
  toggleScreenMode: () => void;
  showDebugPanel: () => void;
  showGenAiPanel: () => void;
  showAiHistoryPanel?: () => void;
  connectOpenArtProvider?: () => void;
  disconnectOpenArtProvider?: () => void;
  openStyleGuide?: () => void;
  resetWorkspaceLayout: () => void;
  applyPhotoEditWorkspace: () => void;
  applyGradingWorkspace: () => void;
  applyAiGenerationWorkspace: () => void;
  openAbout?: () => void;
  openThirdPartyLicenses?: () => void;
  openCommandHelp?: () => void;
  startGuidedSample?: () => void;
  openSettings?: () => void;
  snap?: SnapSettings;
  toggleExtras?: () => void;
  toggleSnap?: () => void;
  toggleSnapTarget?: (target: keyof SnapSettings['targets']) => void;
  setAllSnapTargets?: (enabled: boolean) => void;
  toggleSmartGuides?: () => void;
  toggleGuides?: () => void;
  toggleGrid?: () => void;
  toggleRulers?: () => void;
  newGuide?: () => void;
  toggleGuideLock?: () => void;
  clearGuides?: () => void;
}

const checkedLabel = (label: string, checked: boolean) => checked ? `${label} ✓` : label;

export const createEditorMenuOptions = (
  menu: EditorMenuId,
  state: EditorMenuState,
  labels: EditorMenuLabels,
  commands: EditorMenuCommands,
  aiProviders: EditorAiProviderState = { openArt: 'disconnected' }
): Array<ContextMenuOption<string>> => {
  const layer = state.layer;
  const snap = commands.snap && typeof commands.snap === 'object' && 'targets' in commands.snap
    ? commands.snap
    : createDefaultSnapSettings();

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
        value: 'place-image',
        label: 'Open place...',
        onClick: commands.place,
        disabled: !state.hasDocument || state.saving
      },
      {
        value: 'open-recent',
        label: 'Open Recent',
        disabled: state.saving || commands.recentFiles.length === 0,
        children: [
          ...commands.recentFiles.slice(0, 15).map((file) => ({
            value: `open-recent-${file.id}`,
            label: file.name,
            onClick: () => commands.openRecent(file.id)
          })),
          {
            value: 'clear-recent',
            label: 'Clear list',
            separatorBefore: true,
            onClick: commands.clearRecent
          }
        ]
      },
      {
        value: 'save-corrected',
        label: state.saving ? 'Saving...' : 'Save',
        shortcut: labels.primaryShortcut('S'),
        onClick: commands.save,
        disabled: !state.hasMetadata || !state.hasSourceKey || state.saving
      },
      {
        value: 'export-png',
        label: 'Export PNG',
        separatorBefore: true,
        shortcut: labels.primaryShortcut('S', true),
        onClick: commands.exportPng,
        disabled: !state.hasMetadata || state.saving
      },
      {
        value: 'export',
        label: 'Export',
        children: [
          { value: 'export-jpeg', label: 'JPG...', disabled: !state.hasMetadata || state.saving, onClick: commands.exportJpeg },
          { value: 'export-psd', label: 'Photoshop PSD...', disabled: !state.hasDocument || state.saving, onClick: commands.exportPsd },
          { value: 'export-pdf', label: 'PDF...', disabled: !state.hasDocument || state.saving, onClick: commands.pdfExportPreflight },
          { value: 'format-support', label: 'Format Support...', separatorBefore: true, onClick: commands.openFormatSupport }
        ]
      },
      ...(commands.projectsAvailable ? [{
        value: 'new-project',
        label: 'New Project...',
        separatorBefore: true,
        onClick: commands.newProject,
        disabled: state.saving
      },
      { value: 'open-project', label: 'Open Project...', onClick: commands.openProject, disabled: state.saving },
      {
        value: 'open-recent-project',
        label: 'Recent Projects',
        disabled: state.saving || commands.recentProjects.length === 0,
        children: [
          ...commands.recentProjects.slice(0, 15).map((project) => ({
            value: `open-recent-project-${project.recentId}`,
            label: project.name,
            disabled: !project.available,
            onClick: () => commands.openRecentProject(project.recentId)
          })),
          {
            value: 'clear-recent-projects',
            label: 'Clear list',
            separatorBefore: true,
            onClick: commands.clearRecentProjects
          }
        ]
      },
      {
        value: 'close-project',
        label: commands.activeProject ? `Close Project (${commands.activeProject.name})` : 'Close Project',
        disabled: state.saving || !commands.activeProject,
        onClick: commands.closeProject
      }] : []),
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
        value: 'copy-grade',
        label: 'Copy grade',
        separatorBefore: true,
        onClick: commands.copyGrade,
        disabled: !state.hasMetadata || state.saving
      },
      {
        value: 'paste-grade',
        label: state.copiedGradeName ? `Paste grade: ${state.copiedGradeName}` : 'Paste grade',
        onClick: commands.pasteGrade,
        disabled: !state.hasMetadata || !state.copiedGradeName || state.saving
      },
      {
        value: 'edit-transform',
        label: 'Transform',
        separatorBefore: true,
        disabled: (!layer && !state.hasSelection) || state.saving,
        children: [
          { value: 'transform-rotate-180', label: 'Rotate 180°',
            onClick: () => commands.applyFixedTransform('rotate-180') },
          { value: 'transform-rotate-clockwise-90', label: 'Rotate 90° Clockwise',
            onClick: () => commands.applyFixedTransform('rotate-clockwise-90') },
          { value: 'transform-rotate-counter-clockwise-90', label: 'Rotate 90° Counter Clockwise',
            onClick: () => commands.applyFixedTransform('rotate-counter-clockwise-90') },
          { value: 'transform-flip-horizontal', label: 'Flip Horizontal', separatorBefore: true,
            onClick: () => commands.applyFixedTransform('flip-horizontal') },
          { value: 'transform-flip-vertical', label: 'Flip Vertical',
            onClick: () => commands.applyFixedTransform('flip-vertical') }
        ]
      },
      {
        value: 'assign-profile',
        label: 'Assign Profile',
        separatorBefore: true,
        disabled: !state.documentColor,
        children: [{
          value: 'assign-profile-srgb',
          label: checkedLabel('sRGB', state.documentColor?.profileState === 'assigned'),
          onClick: commands.assignSrgbProfile,
          disabled: !state.documentColor || state.documentColor.profileState === 'assigned'
        }]
      },
      {
        value: 'convert-profile',
        label: 'Convert to Profile...',
        disabled: true,
        disabledReason: 'Profile conversion is not available yet; imported pixels are currently normalized to sRGB.'
      },
      {
        value: 'settings',
        label: 'Preferences...',
        shortcut: labels.primaryShortcut('K'),
        separatorBefore: true,
        onClick: commands.openSettings
      }
    ];
  }

  if (menu === 'ai') {
    return [{
      value: 'ai-providers',
      label: 'Providers',
      children: [
        {
          value: 'ai-provider-openart',
          label: 'OpenArt',
          status: aiProviders.openArt,
          onClick: aiProviders.openArt === 'connected'
            ? (commands.disconnectOpenArtProvider ?? commands.showGenAiPanel)
            : (commands.connectOpenArtProvider ?? commands.showGenAiPanel)
        },
        {
          value: 'ai-provider-higgsfield',
          label: 'Higgsfield',
          disabled: true,
          disabledReason: 'Higgsfield support is planned.'
        },
        {
          value: 'ai-provider-comfyui',
          label: 'ComfyUI',
          disabled: true,
          disabledReason: 'ComfyUI support is planned.'
        }
      ]
    }, {
      value: 'ai-history',
      label: 'Assets',
      separatorBefore: true,
      onClick: commands.showAiHistoryPanel ?? commands.showGenAiPanel
    }];
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
      },
      {
        value: 'remove-object',
        label: 'Remove Object',
        separatorBefore: true,
        onClick: commands.removeObject,
        disabled: !state.hasSelection || state.saving
      },
      {
        value: 'remove-background',
        label: 'Remove Background',
        onClick: commands.removeBackground,
        disabled: !layer || layer.type !== 'raster' || layer.locked || state.saving
      }
    ];
  }

  if (menu === 'image') {
    const adjustmentShortcut = (kind: AdjustmentLayerKind): string | undefined => {
      if (kind === 'levels') return labels.primaryShortcut('L');
      if (kind === 'curves') return labels.primaryShortcut('M');
      if (kind === 'hue-saturation') return labels.primaryShortcut('U');
      if (kind === 'color-balance') return labels.primaryShortcut('B');
      if (kind === 'black-white') return `Alt+Shift+${labels.primaryShortcut('B')}`;
      if (kind === 'invert') return labels.primaryShortcut('I');
      return undefined;
    };
    const imageAdjustments = adjustmentLayerMenuDefinitionGroups()
      .flatMap((group, groupIndex) => group.map((definition, definitionIndex) => ({
        value: `image-adjustments-${definition.id}`,
        label: `${definition.name}...`,
        shortcut: adjustmentShortcut(definition.id),
        separatorBefore: groupIndex > 0 && definitionIndex === 0,
        onClick: () => commands.applyAdjustment(definition.id),
        disabled: !state.hasDocument || state.saving
      })));
    return [{
      value: 'image-size',
      label: 'Image Size...',
      shortcut: labels.primaryShortcut('Alt+I'),
      onClick: commands.openImageSize,
      disabled: !state.hasDocument || state.saving
    }, {
      value: 'canvas-size',
      label: 'Canvas Size...',
      shortcut: labels.primaryShortcut('Alt+C'),
      onClick: commands.openCanvasSize,
      disabled: !state.hasDocument || state.saving
    }, {
      value: 'image-rotation',
      label: 'Image Rotation',
      disabled: !state.hasDocument || state.saving,
      children: [{
        value: 'image-rotation-180', label: '180°',
        onClick: () => commands.applyDocumentGeometry({ operation: 'rotate', rotation: '180' })
      }, {
        value: 'image-rotation-clockwise-90', label: '90° Clockwise',
        onClick: () => commands.applyDocumentGeometry({ operation: 'rotate', rotation: 'clockwise-90' })
      }, {
        value: 'image-rotation-counter-clockwise-90', label: '90° Counter Clockwise',
        onClick: () => commands.applyDocumentGeometry({ operation: 'rotate', rotation: 'counter-clockwise-90' })
      }, {
        value: 'image-rotation-arbitrary', label: 'Arbitrary...',
        onClick: commands.openArbitraryRotation
      }, {
        value: 'flip-canvas-horizontal', label: 'Flip Canvas Horizontal', separatorBefore: true,
        onClick: () => commands.applyDocumentGeometry({ operation: 'flip', axis: 'horizontal' })
      }, {
        value: 'flip-canvas-vertical', label: 'Flip Canvas Vertical',
        onClick: () => commands.applyDocumentGeometry({ operation: 'flip', axis: 'vertical' })
      }]
    }, {
      value: 'image-crop',
      label: 'Crop',
      onClick: commands.beginCrop,
      disabled: !state.hasDocument || state.saving
    }, {
      value: 'image-adjustments',
      label: 'Adjustments',
      children: imageAdjustments
    }, {
      value: 'image-mode',
      label: 'Mode',
      separatorBefore: true,
      disabled: !state.documentColor,
      children: [{
        value: 'image-mode-rgb',
        label: checkedLabel('RGB Color', Boolean(state.documentColor)),
        disabled: true
      }, {
        value: 'image-mode-8-bit',
        label: checkedLabel('8 Bits/Channel', state.documentColor?.bitDepth === 8),
        disabled: true,
        disabledReason: state.documentColor?.bitDepth === 8
          ? 'Current document mode.'
          : 'Bit-depth conversion is not available yet.'
      }, {
        value: 'image-mode-16-bit',
        label: checkedLabel('16 Bits/Channel', state.documentColor?.bitDepth === 16),
        disabled: true,
        disabledReason: state.documentColor?.bitDepth === 16
          ? 'Current document mode.'
          : 'Bit-depth conversion is not available yet.'
      }]
    }, {
      value: 'duplicate-image',
      label: 'Duplicate...',
      separatorBefore: true,
      onClick: commands.duplicateImage,
      disabled: !state.hasDocument || state.saving
    }];
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
      {
        value: 'remove-background',
        label: 'Remove Background',
        onClick: commands.removeBackground,
        disabled: !layer || layer.type !== 'raster' || layer.locked || state.saving
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

  if (menu === 'help') {
    return [
      { value: 'command-help', label: 'Commands and Shortcuts...', onClick: commands.openCommandHelp },
      { value: 'guided-sample', label: 'Start Guided Sample', onClick: commands.startGuidedSample },
      {
        value: 'third-party-licenses',
        label: 'Third-party Licenses...',
        separatorBefore: true,
        onClick: commands.openThirdPartyLicenses
      },
      { value: 'about', label: 'About LightTable...', onClick: commands.openAbout }
    ];
  }

  return [
    {
      value: 'fit',
      label: state.zoomMode === 'fit' ? 'Fit (current)' : 'Fit',
      shortcut: labels.primaryShortcut('0'),
      onClick: commands.fit,
      disabled: !state.hasMetadata
    },
    {
      value: 'actual-size',
      label: state.zoomMode === '100' ? '100% (current)' : '100%',
      shortcut: labels.primaryShortcut('1'),
      onClick: commands.actualSize,
      disabled: !state.hasMetadata
    },
    {
      value: 'show-difference',
      label: state.showDifference ? 'Show corrected' : 'Show reference difference',
      separatorBefore: true,
      onClick: commands.toggleDifference,
      disabled: !state.hasMetadata
    },
    {
      value: 'extras',
      label: checkedLabel('Extras', snap.extrasVisible !== false),
      shortcut: labels.primaryShortcut('H'),
      separatorBefore: true,
      onClick: commands.toggleExtras
    },
    {
      value: 'rulers',
      label: checkedLabel('Rulers', snap.rulersVisible),
      shortcut: labels.primaryShortcut('R'),
      onClick: commands.toggleRulers
    },
    {
      value: 'snap',
      label: checkedLabel('Snap', snap.enabled),
      shortcut: labels.primaryShortcut(';', true),
      onClick: commands.toggleSnap
    },
    {
      value: 'snap-to',
      label: 'Snap To',
      children: [
        { value: 'snap-guides', label: checkedLabel('Guides', snap.targets.guides), onClick: () => commands.toggleSnapTarget?.('guides') },
        { value: 'snap-grid', label: checkedLabel('Grid', snap.targets.grid), disabled: !snap.gridVisible, onClick: () => commands.toggleSnapTarget?.('grid') },
        { value: 'snap-layers', label: checkedLabel('Layers', snap.targets.layers), onClick: () => commands.toggleSnapTarget?.('layers') },
        { value: 'snap-document', label: checkedLabel('Document Bounds', snap.targets.documentBounds), onClick: () => commands.toggleSnapTarget?.('documentBounds') },
        { value: 'snap-all', label: 'All', separatorBefore: true, onClick: () => commands.setAllSnapTargets?.(true) },
        { value: 'snap-none', label: 'None', onClick: () => commands.setAllSnapTargets?.(false) }
      ]
    },
    {
      value: 'show-overlays',
      label: 'Show',
      children: [
        { value: 'show-grid', label: checkedLabel('Grid', snap.gridVisible), onClick: commands.toggleGrid },
        { value: 'show-guides', label: checkedLabel('Guides', snap.guidesVisible), onClick: commands.toggleGuides },
        { value: 'show-smart-guides', label: checkedLabel('Smart Guides', snap.smartGuidesVisible), onClick: commands.toggleSmartGuides }
      ]
    },
    {
      value: 'guides',
      label: 'Guides',
      children: [
        { value: 'new-guide', label: 'New Guide...', onClick: commands.newGuide },
        { value: 'lock-guides', label: checkedLabel('Lock Guides', snap.guidesLocked), onClick: commands.toggleGuideLock },
        { value: 'clear-guides', label: 'Clear Guides', separatorBefore: true, onClick: commands.clearGuides }
      ]
    },
    {
      value: 'workspace',
      label: 'Workspace',
      separatorBefore: true,
      children: [
        { value: 'workspace-photo-edit', label: 'Photo Edit', onClick: commands.applyPhotoEditWorkspace },
        { value: 'workspace-grading', label: 'Grading', onClick: commands.applyGradingWorkspace },
        { value: 'workspace-ai-generation', label: 'AI Generation', onClick: commands.applyAiGenerationWorkspace },
        {
          value: 'reset-workspace-layout',
          label: 'Reset workspace layout',
          separatorBefore: true,
          onClick: commands.resetWorkspaceLayout
        }
      ]
    },
    {
      value: 'show-genai-panel',
      label: 'GenAI panel',
      onClick: commands.showGenAiPanel
    },
    {
      value: 'show-ai-history-panel',
      label: 'Assets panel',
      onClick: commands.showAiHistoryPanel ?? commands.showGenAiPanel
    },
    {
      value: 'show-debug-panel',
      label: 'Debug panel',
      onClick: commands.showDebugPanel
    },
    ...(commands.openStyleGuide ? [{
      value: 'ui-style-guide',
      label: 'UI Style Guide...',
      onClick: commands.openStyleGuide
    }] : []),
    {
      value: 'toggle-screen-mode',
      label: 'Toggle screen mode',
      shortcut: 'F',
      separatorBefore: true,
      onClick: commands.toggleScreenMode
    }
  ];
};
