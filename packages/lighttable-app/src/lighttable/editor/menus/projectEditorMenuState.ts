import { queryLayerCommandCapabilities } from '../../application/layers/layerCommandCapabilities';
import {
  layerIsLocked,
  type ImageDocument
} from '../document/documentTypes';
import { walkRasterLayers } from '../document/layerTree';
import { BLEND_MODES } from '../document/blendModes';
import type { PaintChannel } from '../session/editorSession';
import type { EditorMenuState } from './createEditorMenuOptions';

export interface EditorMenuProjectionInput {
  readonly document: ImageDocument | null;
  readonly saving: boolean;
  readonly hasMetadata: boolean;
  readonly hasSourceKey: boolean;
  readonly hasCompatibilityReport: boolean;
  readonly copiedGradeName: string | null;
  readonly hasSelection: boolean;
  readonly selectionClipboardAvailable: boolean;
  readonly activeChannel: PaintChannel;
  readonly autoAlignPreview: boolean;
  readonly zoomMode: 'fit' | '100' | 'custom';
  readonly showOriginal: boolean;
  readonly showDifference: boolean;
}

/**
 * Builds the complete read-only menu projection from canonical document and
 * presentation state. This keeps command availability identical for web,
 * Electron and any future command palette presentation.
 */
export const projectEditorMenuState = ({
  document,
  saving,
  hasMetadata,
  hasSourceKey,
  hasCompatibilityReport,
  copiedGradeName,
  hasSelection,
  selectionClipboardAvailable,
  activeChannel,
  autoAlignPreview,
  zoomMode,
  showOriginal,
  showDifference
}: EditorMenuProjectionInput): EditorMenuState => {
  const capabilities = document
    ? queryLayerCommandCapabilities(document)
    : null;
  const layer = capabilities?.activeLayer ?? null;
  const siblings = capabilities?.activeSiblings ?? [];
  const activeIndex = capabilities?.activeIndex ?? -1;
  const autoAlignTargets = layer && document
    ? walkRasterLayers(document.layers)
      .map(({ layer: rasterLayer }) => rasterLayer)
      .filter((rasterLayer) =>
        rasterLayer.id !== layer.id
        && rasterLayer.visible
        && rasterLayer.locks.all
      )
    : [];

  return {
    saving,
    hasDocument: Boolean(document),
    hasMetadata,
    hasSourceKey,
    hasCompatibilityReport,
    copiedGradeName,
    hasSelection,
    selectionClipboardAvailable,
    activeChannel,
    layer: layer ? {
      type: layer.type,
      hasMask: Boolean(layer.mask),
      maskEnabled: Boolean(layer.mask?.enabled),
      visible: layer.visible,
      locked: layerIsLocked(layer, 'pixels'),
      clipping: layer.clipping,
      activeIndex,
      siblingCount: siblings.length,
      belowIsRaster: siblings[activeIndex - 1]?.type === 'raster',
      canFlattenGroup: capabilities?.canFlattenActiveGroup ?? false,
      canDelete: capabilities?.canDeleteSelection ?? false
    } : null,
    rasterLayerCount: capabilities?.rasterLayerCount ?? 0,
    layerCount: capabilities?.layerCount ?? 0,
    canFlattenImage: capabilities?.canFlattenImage ?? false,
    autoAlignPreview,
    autoAlignAvailable: Boolean(
      layer
      && layer.type === 'raster'
      && !layerIsLocked(layer, 'position')
      && layer.visible
      && autoAlignTargets.length === 1
    ),
    zoomMode,
    showOriginal,
    showDifference,
    blendModes: BLEND_MODES.map((mode) => ({
      ...mode,
      selected: layer?.blendMode === mode.id,
      separatorBefore: ['darken', 'lighten', 'overlay', 'difference', 'hue'].includes(mode.id)
    }))
  };
};
