import React from 'react';
import { ContextMenu, type ContextMenuOption } from '../../../ui/ContextMenu';
import { lightTableIcon } from '../../../assets/icons';
import { AdjustmentSlider } from '../../AdjustmentSlider';
import type {
  ImageDocument,
  LayerId,
  LayerLocks,
  LayerNode
} from '../document/documentTypes';
import { findLayerNode, siblingLayers } from '../document/layerTree';
import { queryLayerCommandCapabilities } from '../../application/layers/layerCommandCapabilities';
import type { PaintChannel } from '../session/editorSession';
import { BLEND_MODES, type BlendMode } from '../document/blendModes';
import type { LayerStyleId } from '../styles/layerStyleTypes';
import type {
  LayerThumbnailPreview,
  LayerThumbnailSet
} from '../layers/layerThumbnailTypes';
import {
  adjustmentStackHasOwner,
  adjustmentStackOwnerIsEnabled
} from '../../processing/adjustmentStack';

interface LayerPanelProps {
  document: ImageDocument;
  thumbnails: ReadonlyMap<LayerId, LayerThumbnailSet>;
  activeChannel: PaintChannel;
  isolatedMaskLayerId: LayerId | null;
  onMaskIsolationChange: (layerId: LayerId | null) => void;
  onSelect: (layerId: LayerId) => void;
  onChannelChange: (channel: PaintChannel) => void;
  onVisibility: (layerIds: LayerId[], visible: boolean) => void;
  onRename: (layerId: LayerId, name: string) => void;
  onOpacity: (layerId: LayerId, opacity: number) => void;
  onVectorAntiAlias: (layerId: LayerId, antiAlias: boolean) => void;
  onFillOpacity: (layerId: LayerId, opacity: number) => void;
  onOpacityInteractionStart: () => void;
  onOpacityInteractionEnd: () => void;
  onBlendMode: (layerId: LayerId, blendMode: BlendMode) => void;
  onClipping: (layerId: LayerId, clipping: boolean) => void;
  onReorder: (
    layerIds: LayerId[],
    targetLayerId: LayerId,
    placement: 'above' | 'below' | 'inside'
  ) => void;
  onAddMask: () => void;
  onLoadMaskSelection: (layerId: LayerId) => void;
  onToggleMask: () => void;
  onRemoveMask: (layerId: LayerId) => void;
  onLockChange: (layerIds: LayerId[], lock: keyof LayerLocks, locked: boolean) => void;
  onCreate: () => void;
  onCreateAdjustment: () => void;
  onCreateLensFx: () => void;
  onCreateGroup: () => void;
  onGroupSelection: (layerIds: LayerId[]) => void;
  onUngroupSelection: (layerIds: LayerId[]) => void;
  onDelete: (layerIds: LayerId[]) => void;
  onMergeDown: () => void;
  onMergeSelected: (layerIds: LayerId[]) => void;
  onFlattenGroup: (groupId: LayerId) => void;
  onFlattenImage: () => void;
  onEditStyles: (layerId: LayerId, effectId?: LayerStyleId) => void;
  onStyleStackEnabled: (layerId: LayerId, enabled: boolean) => void;
  onLocalGradeEnabled: (layerId: LayerId, enabled: boolean) => void;
  onLocalLensFxEnabled: (layerId: LayerId, enabled: boolean) => void;
  onStyleEnabled: (layerId: LayerId, effectId: LayerStyleId, enabled: boolean) => void;
  onClearStyles: (layerId: LayerId) => void;
  onSelectionChange?: (layerIds: LayerId[]) => void;
}

interface VisualLayerRow {
  layer: LayerNode;
  depth: number;
}

const visualLayerRows = (
  layers: readonly LayerNode[],
  collapsedGroups: ReadonlySet<LayerId>,
  depth = 0
): VisualLayerRow[] => [...layers].reverse().flatMap((layer) => [
  { layer, depth },
  ...(
    layer.type === 'group' && !collapsedGroups.has(layer.id)
      ? visualLayerRows(layer.children, collapsedGroups, depth + 1)
      : []
  )
]);

const layerTypeIcon = (layer: LayerNode) => {
  if (layer.type === 'group') return lightTableIcon('layer_group.png');
  if (layer.type === 'adjustment') {
    return lightTableIcon(
      adjustmentStackHasOwner(layer.adjustmentStack, 'lens-fx')
        && !adjustmentStackHasOwner(layer.adjustmentStack, 'grade')
        ? 'lens_fx.png'
        : 'layer_adjustment.png'
    );
  }
  if (layer.type === 'vector') return lightTableIcon('image.png');
  return layer.pixelSource.kind === 'imported-image'
    ? lightTableIcon('image.png')
    : null;
};

const displayedThumbnailSize = (
  preview: LayerThumbnailPreview | undefined,
  maximumSize = 40,
  fallbackWidth = maximumSize,
  fallbackHeight = maximumSize
) => {
  const sourceWidth = preview?.width && preview.width > 0
    ? preview.width
    : Math.max(1, fallbackWidth);
  const sourceHeight = preview?.height && preview.height > 0
    ? preview.height
    : Math.max(1, fallbackHeight);
  const scale = Math.min(maximumSize / sourceWidth, maximumSize / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale))
  };
};

export const LayerPanel: React.FC<LayerPanelProps> = ({
  document,
  thumbnails,
  activeChannel,
  isolatedMaskLayerId,
  onMaskIsolationChange,
  onSelect,
  onChannelChange,
  onVisibility,
  onRename,
  onOpacity,
  onVectorAntiAlias,
  onFillOpacity,
  onOpacityInteractionStart,
  onOpacityInteractionEnd,
  onBlendMode,
  onClipping,
  onReorder,
  onAddMask,
  onLoadMaskSelection,
  onToggleMask,
  onRemoveMask,
  onLockChange,
  onCreate,
  onCreateAdjustment,
  onCreateLensFx,
  onCreateGroup,
  onGroupSelection,
  onUngroupSelection,
  onDelete,
  onMergeDown,
  onMergeSelected,
  onFlattenGroup,
  onFlattenImage,
  onEditStyles,
  onStyleStackEnabled,
  onLocalGradeEnabled,
  onLocalLensFxEnabled,
  onStyleEnabled,
  onClearStyles,
  onSelectionChange
}) => {
  const draggedLayerIdRef = React.useRef<LayerId | null>(null);
  const clippingGestureLayerRef = React.useRef<LayerId | null>(null);
  const [draggedLayerId, setDraggedLayerId] = React.useState<LayerId | null>(null);
  const [trashDropActive, setTrashDropActive] = React.useState(false);
  const [dropTarget, setDropTarget] = React.useState<{
    layerId: LayerId;
    placement: 'above' | 'below' | 'inside';
  } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<LayerId>>(() => new Set());
  const [collapsedStyles, setCollapsedStyles] = React.useState<Set<LayerId>>(() => new Set());
  const [renamingLayerId, setRenamingLayerId] = React.useState<LayerId | null>(null);
  const [selectedLayerIds, setSelectedLayerIds] = React.useState<Set<LayerId>>(
    () => new Set(document.activeLayerId ? [document.activeLayerId] : [])
  );
  const [moreMenu, setMoreMenu] = React.useState({ open: false, x: 0, y: 0 });
  const selectionAnchorRef = React.useRef<LayerId | null>(document.activeLayerId);
  const rows = visualLayerRows(document.layers, collapsedGroups);
  const allRows = visualLayerRows(document.layers, new Set());
  const allLayerIds = new Set(allRows.map(({ layer }) => layer.id));
  const selectedIds = [...selectedLayerIds].filter((layerId) => allLayerIds.has(layerId));
  const selectedIdsKey = selectedIds.join('\u0000');
  const selectionFor = (layerId: LayerId) =>
    selectedLayerIds.has(layerId) ? selectedIds : [layerId];
  const layerCapabilities = queryLayerCommandCapabilities(document, selectedIds);
  const {
    activeLayer,
    canFlattenActiveGroup,
    canFlattenImage,
    canGroupSelection,
    canMergeDown,
    canMergeSelected,
    canToggleActiveClipping,
    canUngroupSelection
  } = layerCapabilities;

  React.useEffect(() => {
    setSelectedLayerIds((current) => {
      const next = new Set([...current].filter((layerId) => allLayerIds.has(layerId)));
      if (document.activeLayerId && !next.has(document.activeLayerId)) {
        selectionAnchorRef.current = document.activeLayerId;
        return new Set([document.activeLayerId]);
      }
      if (!next.size && document.activeLayerId) next.add(document.activeLayerId);
      return next;
    });
  // The layer tree revision and active id are sufficient; deriving allLayerIds
  // in the dependency list would make every render look like a selection change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.revision, document.activeLayerId]);

  React.useEffect(() => {
    onSelectionChange?.(selectedIds);
  // selectedIds is rebuilt while rendering; the stable id key avoids emitting
  // selection changes merely because another panel property rendered.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdsKey, onSelectionChange]);

  const selectLayer = (
    event: React.MouseEvent,
    layerId: LayerId,
    channel: PaintChannel = 'pixels'
  ) => {
    const toggle = event.ctrlKey || event.metaKey;
    if (event.shiftKey && selectionAnchorRef.current) {
      const visualIds = rows.map(({ layer }) => layer.id);
      const anchorIndex = visualIds.indexOf(selectionAnchorRef.current);
      const layerIndex = visualIds.indexOf(layerId);
      if (anchorIndex >= 0 && layerIndex >= 0) {
        const [start, end] = anchorIndex < layerIndex
          ? [anchorIndex, layerIndex]
          : [layerIndex, anchorIndex];
        setSelectedLayerIds(new Set(visualIds.slice(start, end + 1)));
      }
    } else if (toggle) {
      const next = new Set(selectedLayerIds);
      const removing = next.has(layerId) && next.size > 1;
      if (removing) next.delete(layerId);
      else next.add(layerId);
      setSelectedLayerIds(next);
      selectionAnchorRef.current = layerId;
      const nextActiveId = removing
        ? document.activeLayerId && next.has(document.activeLayerId)
          ? document.activeLayerId
          : [...next][0]
        : layerId;
      if (nextActiveId) onSelect(nextActiveId);
      onChannelChange(channel);
      return;
    } else {
      setSelectedLayerIds(new Set([layerId]));
      selectionAnchorRef.current = layerId;
    }
    onSelect(layerId);
    onChannelChange(channel);
  };

  const moreMenuOptions: Array<ContextMenuOption<string>> = [
    { value: 'new-layer', label: 'New layer', onClick: onCreate },
    { value: 'new-adjustment', label: 'New Grade layer', onClick: onCreateAdjustment },
    { value: 'new-lens-fx', label: 'New Lens Fx layer', onClick: onCreateLensFx },
    { value: 'new-group', label: 'New group', onClick: onCreateGroup },
    {
      value: 'group-selected',
      label: `Group Selected${selectedIds.length > 1 ? ` (${selectedIds.length})` : ''}`,
      separatorBefore: true,
      disabled: !canGroupSelection,
      onClick: () => onGroupSelection(selectedIds)
    },
    {
      value: 'ungroup-selected',
      label: 'Ungroup Selected',
      disabled: !canUngroupSelection,
      onClick: () => onUngroupSelection(selectedIds)
    },
    {
      value: 'clipping-mask',
      label: activeLayer?.clipping ? 'Release Clipping Mask' : 'Create Clipping Mask',
      separatorBefore: true,
      disabled: !activeLayer || !canToggleActiveClipping,
      onClick: () => {
        if (activeLayer) onClipping(activeLayer.id, !activeLayer.clipping);
      }
    },
    {
      value: 'layer-style',
      label: 'Layer Style...',
      disabled: activeLayer?.type !== 'raster',
      onClick: () => {
        if (activeLayer?.type === 'raster') onEditStyles(activeLayer.id);
      }
    },
    {
      value: 'clear-layer-style',
      label: 'Clear Layer Style',
      disabled: activeLayer?.type !== 'raster' || !activeLayer.styleStack.effects.length,
      onClick: () => {
        if (activeLayer?.type === 'raster') onClearStyles(activeLayer.id);
      }
    },
    {
      value: 'merge-down',
      label: 'Merge Down (Ctrl/Cmd+E)',
      separatorBefore: true,
      disabled: !canMergeDown,
      onClick: onMergeDown
    },
    {
      value: 'merge-selected',
      label: `Merge Selected${selectedIds.length > 1 ? ` (${selectedIds.length})` : ''}`,
      disabled: !canMergeSelected,
      onClick: () => onMergeSelected(selectedIds)
    },
    {
      value: 'flatten-group',
      label: 'Flatten Group...',
      disabled: activeLayer?.type !== 'group' || !canFlattenActiveGroup,
      onClick: () => {
        if (activeLayer?.type === 'group') onFlattenGroup(activeLayer.id);
      }
    },
    {
      value: 'flatten-image',
      label: 'Flatten Image...',
      disabled: !canFlattenImage,
      onClick: onFlattenImage
    },
    {
      value: 'delete',
      label: selectedIds.length > 1 ? `Delete Selected (${selectedIds.length})` : 'Delete layer',
      separatorBefore: true,
      disabled: !activeLayer,
      onClick: () => onDelete(selectedIds)
    }
  ];

  return (
    <section className="lighttable-layers" aria-label="Layers">
      {activeLayer ? (
        <>
          <div className="lighttable-layers__blend-lock-row">
            <select
              className="lighttable-layers__blend-mode"
              aria-label="Layer blend mode"
              value={activeLayer.type === 'group' ? 'pass-through' : activeLayer.blendMode}
              disabled={activeLayer.type !== 'raster'}
              title={
                activeLayer.type === 'group'
                  ? 'Pass-through group compositing'
                  : activeLayer.type === 'adjustment'
                    ? 'Adjustment blend modes arrive with recursive adjustment compositing'
                    : undefined
              }
              onChange={(event) => onBlendMode(activeLayer.id, event.currentTarget.value as BlendMode)}
            >
              {activeLayer.type === 'group'
                ? <option value="pass-through">Pass Through</option>
                : BLEND_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
            </select>
            <div className="lighttable-layers__locks" aria-label="Layer locks">
            {([
              ['transparency', 'lock_transparent_pixels.png', 'Lock transparent pixels'],
              ['pixels', 'lock_image_pixels.png', 'Lock image pixels'],
              ['position', 'lock_position.png', 'Lock position'],
              ['all', 'lock_closed.png', 'Lock all']
            ] as const).map(([lock, icon, label]) => (
              <button
                key={lock}
                type="button"
                className={activeLayer.locks[lock] ? 'lighttable-layers__lock-toggle--active' : ''}
                disabled={activeLayer.type !== 'raster'}
                onClick={() => onLockChange(selectionFor(activeLayer.id), lock, !activeLayer.locks[lock])}
                aria-pressed={activeLayer.locks[lock]}
                title={activeLayer.locks[lock] ? label.replace('Lock', 'Unlock') : label}
                aria-label={activeLayer.locks[lock] ? label.replace('Lock', 'Unlock') : label}
              >
                <img src={lightTableIcon(icon)} alt="" aria-hidden="true" />
              </button>
            ))}
            </div>
          </div>
          <div className="lighttable-layers__opacity-controls">
              <AdjustmentSlider
                label="Opacity"
                value={activeLayer.opacity * 100}
                min={0}
                max={100}
                format={(value) => `${Math.round(value)}%`}
                resetValue={100}
                onReset={() => onOpacity(activeLayer.id, 1)}
                onChange={(value) => onOpacity(activeLayer.id, value / 100)}
                onInteractionStart={onOpacityInteractionStart}
                onInteractionEnd={onOpacityInteractionEnd}
              />
              <AdjustmentSlider
                label="Fill"
                value={activeLayer.fillOpacity * 100}
                min={0}
                max={100}
                format={(value) => `${Math.round(value)}%`}
                resetValue={100}
                disabled={activeLayer.type !== 'raster'}
                onReset={() => onFillOpacity(activeLayer.id, 1)}
                onChange={(value) => onFillOpacity(activeLayer.id, value / 100)}
                onInteractionStart={onOpacityInteractionStart}
                onInteractionEnd={onOpacityInteractionEnd}
              />
          </div>
          {activeLayer.type === 'vector' ? (
            <label className="lighttable-layers__vector-antialias">
              <input
                type="checkbox"
                checked={activeLayer.antiAlias}
                onChange={(event) => onVectorAntiAlias(activeLayer.id, event.currentTarget.checked)}
              />
              Anti-alias edges
            </label>
          ) : null}
        </>
      ) : null}
      <div className="lighttable-layers__list">
        {rows.map(({ layer, depth }) => {
          const icon = layerTypeIcon(layer);
          const previews = thumbnails.get(layer.id);
          const fallbackThumbnailWidth = layer.type === 'raster' ? layer.width : 40;
          const fallbackThumbnailHeight = layer.type === 'raster' ? layer.height : 40;
          const pixelThumbnailSize = displayedThumbnailSize(
            previews?.pixels,
            40,
            fallbackThumbnailWidth,
            fallbackThumbnailHeight
          );
          const maskThumbnailSize = displayedThumbnailSize(
            previews?.mask,
            40,
            layer.type === 'raster' ? layer.width : document.width,
            layer.type === 'raster' ? layer.height : document.height
          );
          const hasStyles = layer.styleStack.effects.length > 0;
          const stylesExpanded = hasStyles && !collapsedStyles.has(layer.id);
          const siblings = siblingLayers(document, layer.id);
          const siblingIndex = siblings.findIndex((sibling) => sibling.id === layer.id);
          const clippingBase = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
          const canToggleClipping = layer.clipping || Boolean(clippingBase);
          return (
          <React.Fragment key={layer.id}>
          <div
            data-layer-id={layer.id}
            draggable
            className={[
              'lighttable-layer',
              document.activeLayerId === layer.id ? 'lighttable-layer--active' : '',
              selectedLayerIds.has(layer.id) ? 'lighttable-layer--selected' : '',
              layer.clipping ? 'lighttable-layer--clipped' : '',
              draggedLayerId === layer.id ? 'lighttable-layer--dragging' : '',
              dropTarget?.layerId === layer.id ? `lighttable-layer--drop-${dropTarget.placement}` : ''
            ].filter(Boolean).join(' ')}
            style={{ paddingLeft: `${5 + depth * 16 + (layer.clipping ? 14 : 0)}px` }}
            onPointerDown={(event) => {
              if (!event.altKey || !canToggleClipping) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              // Photoshop exposes clipping on the boundary between a layer
              // and the sibling below it. Keep the target forgiving without
              // hijacking normal row selection or layer dragging.
              if (bounds.bottom - event.clientY > 9) return;
              event.preventDefault();
              event.stopPropagation();
              clippingGestureLayerRef.current = layer.id;
              onClipping(layer.id, !layer.clipping);
            }}
            onClick={(event) => {
              if (clippingGestureLayerRef.current === layer.id) {
                clippingGestureLayerRef.current = null;
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              selectLayer(event, layer.id);
            }}
            onDragStart={(event) => {
              window.getSelection()?.removeAllRanges();
              if (globalThis.document.activeElement instanceof HTMLElement) {
                globalThis.document.activeElement.blur();
              }
              draggedLayerIdRef.current = layer.id;
              setDraggedLayerId(layer.id);
              setDropTarget(null);
              if (!selectedLayerIds.has(layer.id)) {
                setSelectedLayerIds(new Set([layer.id]));
                selectionAnchorRef.current = layer.id;
              }
              onSelect(layer.id);
              onChannelChange('pixels');
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('application/x-lighttable-layer-id', layer.id);
              event.dataTransfer.setData('text/plain', layer.name);
            }}
            onDragOver={(event) => {
              const sourceId = draggedLayerIdRef.current;
              if (!sourceId || sourceId === layer.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              const bounds = event.currentTarget.getBoundingClientRect();
              const relativeY = (event.clientY - bounds.top) / Math.max(1, bounds.height);
              const placement = layer.type === 'group' && relativeY >= 0.25 && relativeY <= 0.75
                ? 'inside'
                : relativeY < 0.5 ? 'above' : 'below';
              setDropTarget((current) =>
                current?.layerId === layer.id && current.placement === placement
                  ? current
                  : { layerId: layer.id, placement }
              );
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setDropTarget((current) => current?.layerId === layer.id ? null : current);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const sourceId = draggedLayerIdRef.current
                ?? event.dataTransfer.getData('application/x-lighttable-layer-id') as LayerId;
              const placement = dropTarget?.layerId === layer.id ? dropTarget.placement : 'above';
              if (sourceId && sourceId !== layer.id) {
                onReorder(
                  selectedLayerIds.has(sourceId) ? selectedIds : [sourceId],
                  layer.id,
                  placement
                );
              }
              draggedLayerIdRef.current = null;
              setDraggedLayerId(null);
              setDropTarget(null);
            }}
            onDragEnd={() => {
              draggedLayerIdRef.current = null;
              setDraggedLayerId(null);
              setDropTarget(null);
            }}
          >
            {layer.clipping ? (
              <span
                className="lighttable-layer__clipping-mark"
                style={{ left: `${5 + depth * 16}px` }}
                title={`Clipped to ${clippingBase?.name ?? 'layer below'}`}
                aria-label={`Clipped to ${clippingBase?.name ?? 'layer below'}`}
              >
                <img src={lightTableIcon('clipping_mask.png')} alt="" aria-hidden="true" />
              </span>
            ) : null}
            {canToggleClipping ? (
              <button
                type="button"
                className="lighttable-layer__clipping-boundary"
                title={`${layer.clipping ? 'Release' : 'Create'} clipping mask: Alt/Option-click`}
                aria-label={`${layer.clipping ? 'Release' : 'Create'} clipping mask with Alt or Option click`}
                onPointerDown={(event) => {
                  if (!event.altKey) return;
                  event.preventDefault();
                  event.stopPropagation();
                  clippingGestureLayerRef.current = layer.id;
                  onClipping(layer.id, !layer.clipping);
                }}
              />
            ) : null}
            {layer.type === 'group' || hasStyles ? (
              <button
                type="button"
                className="lighttable-layer__disclosure"
                onClick={(event) => {
                  event.stopPropagation();
                  if (layer.type === 'group') {
                    setCollapsedGroups((current) => {
                      const next = new Set(current);
                      if (next.has(layer.id)) next.delete(layer.id);
                      else next.add(layer.id);
                      return next;
                    });
                  } else {
                    setCollapsedStyles((current) => {
                      const next = new Set(current);
                      if (next.has(layer.id)) next.delete(layer.id);
                      else next.add(layer.id);
                      return next;
                    });
                  }
                }}
                aria-label={
                  layer.type === 'group'
                    ? collapsedGroups.has(layer.id) ? `Expand ${layer.name}` : `Collapse ${layer.name}`
                    : stylesExpanded ? `Collapse effects for ${layer.name}` : `Expand effects for ${layer.name}`
                }
                title={
                  layer.type === 'group'
                    ? collapsedGroups.has(layer.id) ? 'Expand group' : 'Collapse group'
                    : stylesExpanded ? 'Collapse effects' : 'Expand effects'
                }
              >
                <img
                  src={
                    layer.type === 'group'
                      ? lightTableIcon(collapsedGroups.has(layer.id) ? 'area_closed.png' : 'area_open.png')
                      : lightTableIcon(stylesExpanded ? 'area_open.png' : 'area_closed.png')
                  }
                  alt=""
                />
              </button>
            ) : <span className="lighttable-layer__disclosure-spacer" />}
            <button
              type="button"
              className="lighttable-layer__visibility"
              onClick={(event) => {
                event.stopPropagation();
                onVisibility(selectionFor(layer.id), !layer.visible);
              }}
              aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
              title={layer.visible ? 'Hide layer' : 'Show layer'}
            ><img src={lightTableIcon(layer.visible ? 'visible.png' : 'visible_off.png')} alt="" /></button>
            <span className="lighttable-layer__thumbnail-slot">
              <button
                type="button"
                className={[
                  'lighttable-layer__thumbnail',
                  layer.type === 'raster'
                    ? 'lighttable-layer__thumbnail--transparent'
                    : '',
                  document.activeLayerId === layer.id && activeChannel === 'pixels'
                    ? 'lighttable-layer__thumbnail--active'
                    : ''
                ].filter(Boolean).join(' ')}
                style={pixelThumbnailSize}
                onClick={(event) => {
                  event.stopPropagation();
                  onMaskIsolationChange(null);
                  selectLayer(event, layer.id);
                }}
                title={layer.type === 'raster' ? 'Edit layer pixels' : layer.type === 'group' ? 'Group' : 'Adjustment layer'}
              >
                {previews?.pixels ? (
                  <img
                    className="lighttable-layer__thumbnail-preview"
                    src={previews.pixels.url}
                    width={previews.pixels.width}
                    height={previews.pixels.height}
                    alt=""
                  />
                ) : icon ? <img className="lighttable-layer__type-icon" src={icon} alt="" /> : null}
              </button>
            </span>
            {layer.mask ? (
              <span className="lighttable-layer__thumbnail-slot">
                <button
                  type="button"
                  draggable
                  className={`lighttable-layer__thumbnail lighttable-layer__mask${document.activeLayerId === layer.id && activeChannel === 'mask' ? ' lighttable-layer__thumbnail--active lighttable-layer__thumbnail--active-mask' : ''}${isolatedMaskLayerId === layer.id ? ' lighttable-layer__thumbnail--mask-isolated' : ''}${layer.mask.enabled ? '' : ' lighttable-layer__mask--disabled'}`}
                  style={maskThumbnailSize}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.ctrlKey || event.metaKey) {
                      event.preventDefault();
                      onMaskIsolationChange(null);
                      onLoadMaskSelection(layer.id);
                      return;
                    }
                    if (event.altKey) {
                      event.preventDefault();
                      selectLayer(event, layer.id, 'mask');
                      onMaskIsolationChange(
                        isolatedMaskLayerId === layer.id ? null : layer.id
                      );
                      return;
                    }
                    onMaskIsolationChange(null);
                    selectLayer(event, layer.id, 'mask');
                  }}
                  onDoubleClick={(event) => { event.stopPropagation(); onToggleMask(); }}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    window.getSelection()?.removeAllRanges();
                    onSelect(layer.id);
                    onChannelChange('mask');
                    setTrashDropActive(false);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('application/x-lighttable-layer-mask-id', layer.id);
                  }}
                  onDragEnd={() => setTrashDropActive(false)}
                  title={layer.mask.enabled
                    ? 'Edit mask; Alt-click to isolate; Ctrl/Cmd-click to load selection; double-click to disable'
                    : 'Edit mask; Alt-click to isolate; Ctrl/Cmd-click to load selection; double-click to enable'}
                >
                  {previews?.mask ? (
                    <img
                      className="lighttable-layer__thumbnail-preview"
                      src={previews.mask.url}
                      width={previews.mask.width}
                      height={previews.mask.height}
                      alt=""
                    />
                  ) : 'M'}
                </button>
              </span>
            ) : null}
            <input
              key={`${layer.id}:${layer.name}`}
              className="lighttable-layer__name"
              defaultValue={layer.name}
              readOnly={renamingLayerId !== layer.id}
              draggable={false}
              onPointerDown={(event) => {
                if (renamingLayerId !== layer.id) event.preventDefault();
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (renamingLayerId !== layer.id) selectLayer(event, layer.id);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                const input = event.currentTarget;
                setRenamingLayerId(layer.id);
                requestAnimationFrame(() => {
                  input.focus();
                  input.select();
                });
              }}
              onFocus={() => setRenamingLayerId(layer.id)}
              onBlur={(event) => {
                if (renamingLayerId === layer.id) onRename(layer.id, event.currentTarget.value);
                setRenamingLayerId((current) => current === layer.id ? null : current);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') {
                  event.currentTarget.value = layer.name;
                  event.currentTarget.blur();
                }
              }}
              aria-label="Layer name"
            />
            <span className="lighttable-layer__status">
              {layer.type === 'raster'
                && layer.adjustmentStack
                && adjustmentStackHasOwner(layer.adjustmentStack, 'grade') ? (
                <button
                  type="button"
                  className="lighttable-layer__local-grade"
                  onClick={(event) => {
                    event.stopPropagation();
                    onLocalGradeEnabled(
                      layer.id,
                      !adjustmentStackOwnerIsEnabled(layer.adjustmentStack!, 'grade')
                    );
                  }}
                  title={`${adjustmentStackOwnerIsEnabled(layer.adjustmentStack, 'grade') ? 'Disable' : 'Enable'} local grade`}
                  aria-label={`${adjustmentStackOwnerIsEnabled(layer.adjustmentStack, 'grade') ? 'Disable' : 'Enable'} local grade`}
                >
                  <img
                    src={lightTableIcon(
                      adjustmentStackOwnerIsEnabled(layer.adjustmentStack, 'grade')
                        ? 'layer_adjustment.png'
                        : 'layer_adjustment_off.png'
                    )}
                    alt=""
                  />
                </button>
              ) : null}
              {layer.type === 'raster'
                && layer.adjustmentStack
                && adjustmentStackHasOwner(layer.adjustmentStack, 'lens-fx') ? (
                <button
                  type="button"
                  className="lighttable-layer__local-grade"
                  onClick={(event) => {
                    event.stopPropagation();
                    onLocalLensFxEnabled(
                      layer.id,
                      !adjustmentStackOwnerIsEnabled(layer.adjustmentStack!, 'lens-fx')
                    );
                  }}
                  title={`${adjustmentStackOwnerIsEnabled(layer.adjustmentStack, 'lens-fx') ? 'Disable' : 'Enable'} local Lens Fx`}
                  aria-label={`${adjustmentStackOwnerIsEnabled(layer.adjustmentStack, 'lens-fx') ? 'Disable' : 'Enable'} local Lens Fx`}
                >
                  <img
                    src={lightTableIcon(
                      adjustmentStackOwnerIsEnabled(layer.adjustmentStack, 'lens-fx')
                        ? 'lens_fx.png'
                        : 'lens_fx_off.png'
                    )}
                    alt=""
                  />
                </button>
              ) : null}
              {hasStyles ? <span className="lighttable-layer__fx-mark" aria-label="Layer effects">fx</span> : null}
              {layer.locks.all ? <img className="lighttable-layer__lock" src={lightTableIcon('lock_closed.png')} alt="Locked" /> : null}
            </span>
          </div>
          {stylesExpanded ? (
            <div
              className="lighttable-layer-effects"
              style={{ paddingLeft: `${31 + depth * 16}px` }}
            >
              <div className="lighttable-layer-effect lighttable-layer-effect--summary">
                <button
                  type="button"
                  className="lighttable-layer-effect__visibility"
                  onClick={() => onStyleStackEnabled(layer.id, !layer.styleStack.enabled)}
                  title={layer.styleStack.enabled ? 'Hide all layer effects' : 'Show all layer effects'}
                  aria-label={layer.styleStack.enabled ? 'Hide all layer effects' : 'Show all layer effects'}
                ><img src={lightTableIcon(layer.styleStack.enabled ? 'visible.png' : 'visible_off.png')} alt="" /></button>
                <button type="button" onClick={() => onEditStyles(layer.id)}>Effects</button>
              </div>
              {[...layer.styleStack.effects].reverse().map((effect) => (
                <div className="lighttable-layer-effect" key={effect.id}>
                  <button
                    type="button"
                    className="lighttable-layer-effect__visibility"
                    onClick={() => onStyleEnabled(layer.id, effect.id, !effect.enabled)}
                    title={effect.enabled ? `Hide ${effect.name}` : `Show ${effect.name}`}
                    aria-label={effect.enabled ? `Hide ${effect.name}` : `Show ${effect.name}`}
                  ><img src={lightTableIcon(effect.enabled ? 'visible.png' : 'visible_off.png')} alt="" /></button>
                  <button type="button" onClick={() => onEditStyles(layer.id, effect.id)}>{effect.name}</button>
                </div>
              ))}
            </div>
          ) : null}
          </React.Fragment>
          );
        })}
      </div>
      <footer className="lighttable-layers__footer">
        <button
          type="button"
          className="lighttable-layers__fx-button"
          onClick={() => {
            if (activeLayer?.type === 'raster') onEditStyles(activeLayer.id);
          }}
          disabled={activeLayer?.type !== 'raster'}
          title={activeLayer?.type === 'raster' ? 'Add layer style' : 'Layer Styles currently require a raster layer'}
          aria-label="Add layer style"
        >fx</button>
        <button
          type="button"
          onClick={() => {
            if (selectedIds.length) onGroupSelection(selectedIds);
            else onCreateGroup();
          }}
          disabled={selectedIds.length > 0 && !canGroupSelection}
          title={selectedIds.length ? 'Group selected layers' : 'New group'}
          aria-label={selectedIds.length ? 'Group selected layers' : 'New group'}
        ><img src={lightTableIcon('add_group.png')} alt="" aria-hidden="true" /></button>
        <button
          type="button"
          onClick={onAddMask}
          disabled={
            !activeLayer
            || activeLayer.type === 'group'
            || Boolean(activeLayer.mask)
          }
          title="Add layer mask"
          aria-label="Add layer mask"
        ><img src={lightTableIcon('add_mask.png')} alt="" aria-hidden="true" /></button>
        <button
          type="button"
          onClick={onCreateAdjustment}
          title="New Grade layer"
          aria-label="New Grade layer"
        ><img src={lightTableIcon('add_adjustment_layer.png')} alt="" aria-hidden="true" /></button>
        <button
          type="button"
          onClick={onCreateLensFx}
          title="New Lens Fx layer"
          aria-label="New Lens Fx layer"
        ><img src={lightTableIcon('lens_fx.png')} alt="" aria-hidden="true" /></button>
        <button
          type="button"
          onClick={onCreate}
          title="New raster layer"
          aria-label="New raster layer"
        ><img src={lightTableIcon('add_layer.png')} alt="" aria-hidden="true" /></button>
        <button
          type="button"
          className={trashDropActive ? 'lighttable-layers__trash--drop-active' : undefined}
          onClick={() => onDelete(selectedIds)}
          disabled={!activeLayer}
          onDragEnter={(event) => {
            const types = Array.from(event.dataTransfer.types);
            if (
              !types.includes('application/x-lighttable-layer-id')
              && !types.includes('application/x-lighttable-layer-mask-id')
            ) return;
            event.preventDefault();
            setTrashDropActive(true);
          }}
          onDragOver={(event) => {
            const types = Array.from(event.dataTransfer.types);
            if (
              !types.includes('application/x-lighttable-layer-id')
              && !types.includes('application/x-lighttable-layer-mask-id')
            ) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setTrashDropActive(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setTrashDropActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const maskLayerId = event.dataTransfer.getData(
              'application/x-lighttable-layer-mask-id'
            ) as LayerId;
            if (maskLayerId) {
              onRemoveMask(maskLayerId);
            } else {
              const sourceLayerId = (
                draggedLayerIdRef.current
                ?? event.dataTransfer.getData('application/x-lighttable-layer-id')
              ) as LayerId;
              if (sourceLayerId) {
                onDelete(selectedLayerIds.has(sourceLayerId) ? selectedIds : [sourceLayerId]);
              }
            }
            draggedLayerIdRef.current = null;
            setDraggedLayerId(null);
            setDropTarget(null);
            setTrashDropActive(false);
          }}
          title="Delete layer or mask"
          aria-label="Delete layer or mask"
        ><img src={lightTableIcon('layer_trash.png')} alt="" aria-hidden="true" /></button>
        <button
          type="button"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            setMoreMenu({ open: true, x: bounds.right, y: bounds.top });
          }}
          title="Layers menu"
          aria-label="Layers menu"
        ><img src={lightTableIcon('more_menu.png')} alt="" aria-hidden="true" /></button>
      </footer>
      <ContextMenu
        open={moreMenu.open}
        x={moreMenu.x}
        y={moreMenu.y}
        onClose={() => setMoreMenu((current) => ({ ...current, open: false }))}
        options={moreMenuOptions}
      />
    </section>
  );
};
