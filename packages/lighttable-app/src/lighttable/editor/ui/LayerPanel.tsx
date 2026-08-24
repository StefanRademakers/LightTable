import { ButtonBase } from '../../../ui/ButtonBase';
import React from 'react';
import { ContextMenu, type ContextMenuOption } from '../../../ui/ContextMenu';
import { AnchoredViewportMenu } from '../../../ui/AnchoredViewportMenu';
import { lightTableIcon } from '../../../assets/icons';
import { AdjustmentSlider } from '../../../ui/AdjustmentSlider';
import { FormSelect } from '../../../ui/FormSelect';
import { SquareIconButton } from '../../../ui/SquareIconButton';
import {
  layerSupportsContentCompositing,
  layerSupportsLayerStyles
} from '../document/documentTypes';
import type { ImageDocument, DocumentFontAsset, LayerId, LayerLocks, LayerNode }
  from '../document/documentTypes';
import { findLayerNode, siblingLayers } from '../document/layerTree';
import { queryLayerCommandCapabilities } from '../../application/layers/layerCommandCapabilities';
import { layerTreeItemAccessibility, useLayerTreeKeyboardNavigation } from '../../application/layers/useLayerTreeKeyboardNavigation';
import { primaryShortcutLabel } from '../../application/input/editorShortcutPresentation';
import type { PaintChannel } from '../session/editorSession';
import { BLEND_MODES, type BlendMode } from '../document/blendModes';
import type { LayerStyleId } from '../styles/layerStyleTypes';
import type {
  LayerThumbnailSet
} from '../layers/layerThumbnailTypes';
import { layerThumbnailDimensions } from '../layers/layerThumbnailTypes';
import { layerRowInset } from '../layers/layerTreeGeometry';
import {
  adjustmentStackHasOwner,
  type LocalProcessingKind
} from '../../processing/adjustmentStack';
import type { TextFontDiagnostic } from '../../text/fonts/textLayerFontStatus';
import { layerStyleTreeEffects } from './layerStyleTreePresentation';
import { buildDocumentCapabilityFindings } from '../compatibility/documentCapabilityFindings';
import { LayerCompatibilityBadge } from './LayerCompatibilityBadge';
import { layerCompatibilityPresentation } from './layerCompatibilityPresentation';
import {
  AttachedAdjustmentTreeRows,
  LocalProcessingTreeRows,
  localProcessingTreeItems
} from './LocalProcessingTreeRows';
import type { PropertiesInspectorTarget } from '../../application/properties/propertiesInspectorTarget';
import {
  adjustmentLayerMenuDefinitionGroups,
  adjustmentLayerDefinition,
  type AdjustmentLayerKind
} from '../../processing/adjustmentLayerCatalog';
import { resolveLayerSelectionGesture } from '../../application/layers/layerSelectionModel';

interface LayerPanelProps {
  document: ImageDocument;
  availableFonts: readonly DocumentFontAsset[];
  textFontDiagnostics?: readonly TextFontDiagnostic[];
  thumbnails: ReadonlyMap<LayerId, LayerThumbnailSet>;
  activeChannel: PaintChannel;
  isolatedMaskLayerId: LayerId | null;
  openMaskEditingOnDoubleClick: boolean;
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
  onLoadTransparencySelection: (layerId: LayerId) => void;
  onToggleMask: () => void;
  onMaskLinked: (layerId: LayerId, linked: boolean) => void;
  onRemoveMask: (layerId: LayerId) => void;
  onLockChange: (layerIds: LayerId[], lock: keyof LayerLocks, locked: boolean) => void;
  onCreate: () => void;
  onCreateAdjustment: () => void;
  onCreateCurvesAdjustment: () => void;
  onCreateLocalProcessing: (layerId: LayerId, kind: LocalProcessingKind) => void;
  onCreateAdjustmentKind: (kind: AdjustmentLayerKind) => void;
  onCreateAttachedAdjustment: (layerId: LayerId, kind: AdjustmentLayerKind) => string | null;
  onCreateGroup: () => void;
  onGroupSelection: (layerIds: LayerId[]) => void;
  onUngroupSelection: (layerIds: LayerId[]) => void;
  onDelete: (layerIds: LayerId[]) => void;
  onDuplicate: () => void;
  onRasterizeLayer: () => void;
  onConvertTextToShape: (layerId: LayerId) => void;
  onRemoveBackground: () => void;
  onMergeDown: () => void;
  onMergeSelected: (layerIds: LayerId[]) => void;
  onFlattenGroup: (groupId: LayerId) => void;
  onFlattenImage: () => void;
  onEditStyles: (layerId: LayerId, effectId?: LayerStyleId) => void;
  onStyleStackEnabled: (layerId: LayerId, enabled: boolean) => void;
  onLocalGradeEnabled: (layerId: LayerId, enabled: boolean) => void;
  onLocalCurvesEnabled: (layerId: LayerId, enabled: boolean) => void;
  onLocalLensFxEnabled: (layerId: LayerId, enabled: boolean) => void;
  onRemoveLocalProcessing: (layerId: LayerId, owner: LocalProcessingKind) => void;
  onAttachedAdjustmentEnabled: (layerId: LayerId, adjustmentId: string, enabled: boolean) => void;
  onRemoveAttachedAdjustment: (layerId: LayerId, adjustmentId: string) => void;
  onStyleEnabled: (layerId: LayerId, effectId: LayerStyleId, enabled: boolean) => void;
  onRemoveStyle: (layerId: LayerId, effectId: LayerStyleId) => void;
  onClearStyles: (layerId: LayerId) => void;
  selectedLayerIds: readonly LayerId[];
  onSelectionChange: (layerIds: LayerId[]) => void;
  onLayerNamePointerDown: (layerId: LayerId, activeLayerId: LayerId | null) => void;
  consumeLayerNameRenameGesture: (layerId: LayerId) => boolean;
  cancelLayerNameRenameGesture: () => void;
  editingTextLayerId?: LayerId | null;
  onEditText?: (layerId: LayerId) => void;
  onOpenFontReport?: (layerId: LayerId) => void;
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

interface VisualLayerRow {
  layer: LayerNode;
  depth: number;
}

type LayerSubtarget = Extract<PropertiesInspectorTarget,
  { kind: 'processing' | 'attached-processing' | 'style-stack' | 'style' }>;

export const LAYER_SUBTARGET_DRAG_TYPE = 'application/x-lighttable-layer-subtarget';

const parseLayerSubtarget = (value: string): LayerSubtarget | null => {
  try {
    const target = JSON.parse(value) as Partial<LayerSubtarget>;
    if (typeof target.layerId !== 'string') return null;
    if (target.kind === 'processing'
      && (target.owner === 'grade' || target.owner === 'curves' || target.owner === 'lens-fx')) {
      return target as LayerSubtarget;
    }
    if (target.kind === 'attached-processing' && typeof target.adjustmentId === 'string') {
      return target as LayerSubtarget;
    }
    if (target.kind === 'style-stack') return target as LayerSubtarget;
    if (target.kind === 'style' && typeof target.effectId === 'string') return target as LayerSubtarget;
    return null;
  } catch {
    return null;
  }
};

export const LAYER_CREATION_OPTIONS = [
  ...adjustmentLayerMenuDefinitionGroups().flatMap((group, groupIndex) =>
    group.filter((definition) => definition.id !== 'grain').map((definition, definitionIndex) => ({
      id: definition.id,
      label: `New ${definition.name}${definition.family === 'photoshop' ? ' adjustment' : ''} layer`,
      menuLabel: definition.menuLabel,
      iconName: definition.iconName,
      sectionStart: groupIndex > 0 && definitionIndex === 0
    })))
] as const;

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

/** Ordinary processing layers always remain in the canonical layer tree. */
export const layerIsDocumentFx = (_layer: LayerNode): boolean => false;

export const layerHasAnyLock = (layer: LayerNode): boolean =>
  Object.values(layer.locks).some(Boolean);

const layerTypeIcon = (layer: LayerNode) => {
  if (layer.type === 'group') return lightTableIcon('layer_group.png');
  if (layer.type === 'adjustment') {
    if (layer.adjustmentKind) {
      return lightTableIcon(adjustmentLayerDefinition(layer.adjustmentKind).iconName);
    }
    return lightTableIcon(
      adjustmentStackHasOwner(layer.adjustmentStack, 'lens-fx')
        && !adjustmentStackHasOwner(layer.adjustmentStack, 'grade')
        ? 'lens_fx.png'
        : 'layer_adjustment.png'
    );
  }
  if (layer.type === 'vector') return lightTableIcon('image.png');
  if (layer.type === 'text') return null;
  return layer.pixelSource.kind === 'imported-image'
    ? lightTableIcon('image.png')
    : null;
};

export const LayerPanel: React.FC<LayerPanelProps> = ({
  document,
  availableFonts,
  textFontDiagnostics = [],
  thumbnails,
  activeChannel,
  isolatedMaskLayerId,
  openMaskEditingOnDoubleClick,
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
  onLoadTransparencySelection,
  onToggleMask,
  onMaskLinked,
  onRemoveMask,
  onLockChange,
  onCreate,
  onCreateAdjustment,
  onCreateCurvesAdjustment,
  onCreateLocalProcessing,
  onCreateAdjustmentKind,
  onCreateAttachedAdjustment,
  onCreateGroup,
  onGroupSelection,
  onUngroupSelection,
  onDelete,
  onDuplicate,
  onRasterizeLayer,
  onConvertTextToShape,
  onRemoveBackground,
  onMergeDown,
  onMergeSelected,
  onFlattenGroup,
  onFlattenImage,
  onEditStyles,
  onStyleStackEnabled,
  onLocalGradeEnabled,
  onLocalCurvesEnabled,
  onLocalLensFxEnabled,
  onRemoveLocalProcessing,
  onAttachedAdjustmentEnabled,
  onRemoveAttachedAdjustment,
  onStyleEnabled,
  onRemoveStyle,
  onClearStyles,
  selectedLayerIds: controlledSelectedLayerIds,
  onSelectionChange,
  onLayerNamePointerDown,
  consumeLayerNameRenameGesture,
  cancelLayerNameRenameGesture,
  editingTextLayerId = null,
  onEditText,
  onOpenFontReport,
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
  const draggedLayerIdRef = React.useRef<LayerId | null>(null);
  const layerNamePointerFocusRef = React.useRef(false);
  const clippingGestureLayerRef = React.useRef<LayerId | null>(null);
  const [clippingBoundaryHoverLayerId, setClippingBoundaryHoverLayerId] = React.useState<LayerId | null>(null);
  const [draggedLayerId, setDraggedLayerId] = React.useState<LayerId | null>(null);
  const [groupDropActive, setGroupDropActive] = React.useState(false);
  const [duplicateDropActive, setDuplicateDropActive] = React.useState(false);
  const [trashDropActive, setTrashDropActive] = React.useState(false);
  const [dropTarget, setDropTarget] = React.useState<{
    layerId: LayerId;
    placement: 'above' | 'below' | 'inside';
  } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<LayerId>>(() => new Set());
  const [collapsedStyles, setCollapsedStyles] = React.useState<Set<LayerId>>(() => new Set());
  const [renamingLayerId, setRenamingLayerId] = React.useState<LayerId | null>(null);
  const [createLayerMenuOpen, setCreateLayerMenuOpen] = React.useState(false);
  const createLayerMenuTriggerRef = React.useRef<HTMLButtonElement>(null);
  const closeCreateLayerMenu = React.useCallback(() => setCreateLayerMenuOpen(false), []);
  const selectedLayerIds = React.useMemo(
    () => new Set(controlledSelectedLayerIds),
    [controlledSelectedLayerIds]
  );
  const [moreMenu, setMoreMenu] = React.useState<{
    open: boolean;
    x: number;
    y: number;
    source: 'footer' | 'context';
  }>({ open: false, x: 0, y: 0, source: 'footer' });
  const [subtargetMenu, setSubtargetMenu] = React.useState<{
    open: boolean;
    x: number;
    y: number;
    target: LayerSubtarget | null;
  }>({ open: false, x: 0, y: 0, target: null });
  const selectionAnchorRef = React.useRef<LayerId | null>(document.activeLayerId);
  const thumbnailDimensions = layerThumbnailDimensions(document.width, document.height);
  const capabilityFindings = React.useMemo(() => buildDocumentCapabilityFindings(
    document.photoshopImportReport ?? null, textFontDiagnostics
  ), [document.photoshopImportReport, textFontDiagnostics]);
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
    canEditActiveLayerStyles,
    canFlattenActiveGroup,
    canFlattenImage,
    canGroupSelection,
    canDuplicateActiveLayer,
    canRasterizeActiveLayer,
    canMergeDown,
    canMergeSelected,
    canToggleActiveClipping,
    canUngroupSelection
  } = layerCapabilities;
  const canDeleteSelection = layerCapabilities.canDeleteSelection;
  const activeIsDocumentFx = false;
  const selectionContainsDocumentFx = false;
  const compositeLayerIsActive = true;
  const layerCreationHandlers = (id: (typeof LAYER_CREATION_OPTIONS)[number]['id']) => {
    if (id === 'grade') return onCreateAdjustment;
    if (id === 'curves') return onCreateCurvesAdjustment;
    return () => onCreateAdjustmentKind(id);
  };

  React.useEffect(() => {
    const valid = controlledSelectedLayerIds.filter((layerId) => allLayerIds.has(layerId));
    if (document.activeLayerId && !valid.includes(document.activeLayerId)) {
      selectionAnchorRef.current = document.activeLayerId;
      onSelectionChange([document.activeLayerId]);
    } else if (!valid.length && document.activeLayerId) {
      onSelectionChange([document.activeLayerId]);
    } else if (valid.length !== controlledSelectedLayerIds.length) {
      onSelectionChange(valid);
    }
  // The layer tree revision and active id are sufficient; deriving allLayerIds
  // in the dependency list would make every render look like a selection change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.revision, document.activeLayerId, inspectorTarget.kind,
    selectedIdsKey, onSelectionChange]);

  const setSelectedLayerIds: React.Dispatch<React.SetStateAction<Set<LayerId>>> = React.useCallback(
    (update) => {
      const next = typeof update === 'function' ? update(selectedLayerIds) : update;
      onSelectionChange([...next]);
    },
    [onSelectionChange, selectedLayerIds]
  );

  const selectLayer = (
    event: Pick<React.MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>,
    layerId: LayerId,
    channel: PaintChannel = 'pixels'
  ) => {
    const next = resolveLayerSelectionGesture(rows.map(({ layer }) => layer.id), {
      selectedLayerIds: selectedIds,
      anchorLayerId: selectionAnchorRef.current,
      activeLayerId: document.activeLayerId
    }, {
      targetLayerId: layerId,
      extend: event.shiftKey,
      toggle: event.ctrlKey || event.metaKey
    });
    onSelectionChange([...next.selectedLayerIds]);
    selectionAnchorRef.current = next.anchorLayerId;
    if (next.activeLayerId) onSelect(next.activeLayerId);
    onChannelChange(channel);
    if (next.activeLayerId) onInspectLayer(next.activeLayerId, channel);
  };

  const beginLayerPointerSelection = (
    event: React.PointerEvent<HTMLDivElement>,
    layerId: LayerId
  ) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const selectionSurface = target === event.currentTarget
      || Boolean(target.closest('.lighttable-layer__name, .lighttable-layer__thumbnail'));
    if (!selectionSurface) return;
    const thumbnail = target.closest('.lighttable-layer__thumbnail');
    if (thumbnail && (event.ctrlKey || event.metaKey)) return;
    if (event.shiftKey) event.preventDefault();
    if (event.shiftKey || event.ctrlKey || event.metaKey || !selectedLayerIds.has(layerId)) {
      selectLayer(event, layerId);
    }
  };

  const restoreParentTarget = (layerId: LayerId) => {
    onSelect(layerId);
    onChannelChange('pixels');
    onInspectLayer(layerId, 'pixels');
  };

  const deleteTreeTarget = (target: PropertiesInspectorTarget) => {
    if (target.kind === 'mask') {
      onRemoveMask(target.layerId);
      restoreParentTarget(target.layerId);
      return;
    }
    if (target.kind === 'processing') {
      onRemoveLocalProcessing(target.layerId, target.owner);
      restoreParentTarget(target.layerId);
      return;
    }
    if (target.kind === 'attached-processing') {
      onRemoveAttachedAdjustment(target.layerId, target.adjustmentId);
      restoreParentTarget(target.layerId);
      return;
    }
    if (target.kind === 'style') {
      onRemoveStyle(target.layerId, target.effectId);
      restoreParentTarget(target.layerId);
      return;
    }
    if (target.kind === 'style-stack') {
      onClearStyles(target.layerId);
      restoreParentTarget(target.layerId);
      return;
    }
    onDelete(selectedIds);
  };

  const selectedDeleteTarget = (): PropertiesInspectorTarget => {
    if (
      inspectorTarget.kind !== 'none'
      && inspectorTarget.kind !== 'layer'
      && inspectorTarget.kind !== 'document-processing'
      && inspectorTarget.layerId === document.activeLayerId
    ) return inspectorTarget;
    return document.activeLayerId
      ? { kind: 'layer', layerId: document.activeLayerId }
      : { kind: 'none' };
  };

  const openSubtargetMenu = (
    event: React.MouseEvent,
    target: LayerSubtarget
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setMoreMenu((current) => ({ ...current, open: false }));
    setSubtargetMenu({
      open: true,
      x: event.clientX,
      y: event.clientY,
      target
    });
  };

  const beginSubtargetDrag = (
    event: React.DragEvent,
    target: LayerSubtarget,
    label: string
  ) => {
    event.stopPropagation();
    draggedLayerIdRef.current = null;
    setDraggedLayerId(null);
    setDropTarget(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(LAYER_SUBTARGET_DRAG_TYPE, JSON.stringify(target));
    event.dataTransfer.setData('text/plain', label);
  };

  const selectedStyleTarget = subtargetMenu.target?.kind === 'style'
    ? subtargetMenu.target
    : null;
  const selectedStyleName = selectedStyleTarget
    ? findLayerNode(document.layers, selectedStyleTarget.layerId)?.node.styleStack.effects
      .find((effect) => effect.id === selectedStyleTarget.effectId)?.name
    : null;
  const subtargetMenuOptions: Array<ContextMenuOption<string>> = subtargetMenu.target
    ? [{
        value: 'remove-subtarget',
        label: subtargetMenu.target.kind === 'processing'
          ? `Remove Local ${subtargetMenu.target.owner === 'lens-fx'
            ? 'Lens Fx'
            : subtargetMenu.target.owner === 'curves' ? 'Curves' : 'Grade'}`
          : subtargetMenu.target.kind === 'attached-processing'
            ? 'Remove Attached Adjustment'
          : subtargetMenu.target.kind === 'style-stack'
            ? 'Clear Layer Effects'
            : `Delete ${selectedStyleName ?? 'Layer Effect'}`,
        onClick: () => deleteTreeTarget(subtargetMenu.target!)
      }]
    : [];
  const handleLayerTreeKeyDown = useLayerTreeKeyboardNavigation({ rows, selectionFor, setSelected: setSelectedLayerIds, selectionAnchor: selectionAnchorRef, activate: (layerId) => { onSelect(layerId); onChannelChange('pixels'); onInspectLayer(layerId, 'pixels'); }, toggleVisibility: onVisibility, beginRename: (layerId) => { setRenamingLayerId(layerId); requestAnimationFrame(() => globalThis.document.getElementById(`lighttable-layer-name-${layerId}`)?.focus()); }, editText: onEditText, openContextMenu: (x, y) => setMoreMenu({ open: true, x, y, source: 'context' }) });

  const moreMenuOptions: Array<ContextMenuOption<string>> = [
    ...(moreMenu.source === 'footer' ? [
      { value: 'new-layer', label: 'New layer', onClick: onCreate },
      { value: 'new-group', label: 'New group', onClick: onCreateGroup }
    ] : []),
    {
      value: 'duplicate-layer',
      label: 'Duplicate Layer',
      separatorBefore: moreMenu.source === 'footer',
      disabled: !canDuplicateActiveLayer,
      onClick: onDuplicate
    },
    {
      value: 'rename-layer',
      label: 'Rename Layer',
      disabled: !activeLayer,
      onClick: () => {
        if (!activeLayer) return;
        setRenamingLayerId(activeLayer.id);
        requestAnimationFrame(() => {
          const input = globalThis.document?.getElementById(
            `lighttable-layer-name-${activeLayer.id}`
          );
          if (input instanceof HTMLInputElement) {
            input.focus();
            input.select();
          }
        });
      }
    },
    ...(activeLayer?.type === 'text' ? [{
      value: 'convert-text-to-shape',
      label: 'Convert to Shape...',
      disabled: activeLayer.locks.all || activeLayer.locks.pixels,
      onClick: () => onConvertTextToShape(activeLayer.id)
    }] : []),
    {
      value: 'remove-background',
      label: 'Remove Background',
      disabled: activeLayer?.type !== 'raster' || activeLayer.locks.all || activeLayer.locks.pixels,
      onClick: onRemoveBackground
    },
    {
      value: 'group-selected',
      label: `Group Selected${selectedIds.length > 1 ? ` (${selectedIds.length})` : ''}`,
      separatorBefore: true,
      disabled: selectionContainsDocumentFx || !canGroupSelection,
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
      disabled: activeIsDocumentFx || !activeLayer || !canToggleActiveClipping,
      onClick: () => {
        if (activeLayer) onClipping(activeLayer.id, !activeLayer.clipping);
      }
    },
    {
      value: 'layer-style',
      label: 'Layer Style...',
      disabled: activeIsDocumentFx || !canEditActiveLayerStyles,
      onClick: () => {
        if (activeLayer && layerSupportsLayerStyles(activeLayer)) onEditStyles(activeLayer.id);
      }
    },
    {
      value: 'clear-layer-style',
      label: 'Clear Layer Style',
      disabled: !canEditActiveLayerStyles || !activeLayer?.styleStack.effects.length,
      onClick: () => {
        if (activeLayer && layerSupportsLayerStyles(activeLayer)) onClearStyles(activeLayer.id);
      }
    },
    ...(moreMenu.source === 'context'
      ? [{
          value: 'vector-antialias',
          label: activeLayer?.type === 'vector' && activeLayer.antiAlias
            ? 'Disable anti-alias edges'
            : 'Enable anti-alias edges',
          separatorBefore: true,
          disabled: activeLayer?.type !== 'vector',
          onClick: () => {
            if (activeLayer?.type === 'vector') {
              onVectorAntiAlias(activeLayer.id, !activeLayer.antiAlias);
            }
          }
        }]
      : []),
    {
      value: 'merge-down',
      label: 'Merge Down',
      shortcut: primaryShortcutLabel('E'),
      separatorBefore: true,
      disabled: activeIsDocumentFx || !canMergeDown,
      onClick: onMergeDown
    },
    {
      value: 'merge-selected',
      label: `Merge Selected${selectedIds.length > 1 ? ` (${selectedIds.length})` : ''}`,
      disabled: selectionContainsDocumentFx || !canMergeSelected,
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
      value: 'rasterize-layer',
      label: 'Rasterize Layer',
      disabled: !canRasterizeActiveLayer,
      onClick: onRasterizeLayer
    },
    {
      value: 'delete',
      label: selectedIds.length > 1 ? `Delete Selected (${selectedIds.length})` : 'Delete layer',
      separatorBefore: true,
      disabled: !activeLayer || !canDeleteSelection,
      onClick: () => onDelete(selectedIds)
    }
  ];

  return (
    <section className="lighttable-layers" aria-label="Layers">
      <div className="lighttable-layers__composite-controls">
      {activeLayer ? (
        <>
          <div className="lighttable-layers__blend-lock-row">
            <FormSelect
              className="lighttable-layers__blend-mode"
              aria-label="Layer blend mode"
              value={activeLayer.type === 'group' ? 'pass-through' : activeLayer.blendMode}
              disabled={activeLayer.type === 'group'}
              title={
                activeLayer.type === 'group'
                  ? 'Pass-through group compositing'
                  : undefined
              }
              onChange={(event) => onBlendMode(activeLayer.id, event.currentTarget.value as BlendMode)}
            >
              {activeLayer.type === 'group'
                ? <option value="pass-through">Pass Through</option>
                : BLEND_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
            </FormSelect>
            <div className="lighttable-layers__locks" aria-label="Layer locks">
            {([
              ['transparency', 'lock_transparent_pixels.png', 'Lock transparent pixels'],
              ['pixels', 'lock_image_pixels.png', 'Lock image pixels'],
              ['position', 'lock_position.png', 'Lock position'],
              ['all', 'lock_closed.png', 'Lock all']
            ] as const).map(([lock, icon, label]) => (
              <ButtonBase
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
              </ButtonBase>
            ))}
            </div>
          </div>
          <div className="lighttable-layers__opacity-controls">
              <AdjustmentSlider
                label="Opacity"
                layout="layer-row"
                value={activeLayer.opacity * 100}
                min={0}
                max={100}
                format={(value) => `${Math.round(value)}%`}
                resetValue={100}
                disabled={activeIsDocumentFx}
                onReset={() => onOpacity(activeLayer.id, 1)}
                onChange={(value) => onOpacity(activeLayer.id, value / 100)}
                onInteractionStart={onOpacityInteractionStart}
                onInteractionEnd={onOpacityInteractionEnd}
              />
              <AdjustmentSlider
                label="Fill"
                layout="layer-row"
                value={activeLayer.fillOpacity * 100}
                min={0}
                max={100}
                format={(value) => `${Math.round(value)}%`}
                resetValue={100}
                disabled={activeIsDocumentFx || !layerSupportsContentCompositing(activeLayer)}
                onReset={() => onFillOpacity(activeLayer.id, 1)}
                onChange={(value) => onFillOpacity(activeLayer.id, value / 100)}
                onInteractionStart={onOpacityInteractionStart}
                onInteractionEnd={onOpacityInteractionEnd}
              />
          </div>
        </>
      ) : null}
      </div>
      <div className="lighttable-layers__list" role="tree" aria-label="Layer stack" data-editor-native-tab-navigation="tab-only">
        {rows.map(({ layer, depth }) => {
          const documentFx = layerIsDocumentFx(layer);
          const icon = layerTypeIcon(layer);
          const previews = thumbnails.get(layer.id);
          const localProcessingItems = localProcessingTreeItems(layer);
          const attachedAdjustmentItems = layer.type === 'raster'
            ? layer.attachedAdjustments ?? []
            : [];
          const visibleStyleEffects = layerStyleTreeEffects(layer.styleStack);
          const hasStyles = visibleStyleEffects.length > 0;
          const hasExpandableChildren = localProcessingItems.length > 0
            || attachedAdjustmentItems.length > 0
            || hasStyles;
          const childrenExpanded = hasExpandableChildren && !collapsedStyles.has(layer.id);
          const siblings = siblingLayers(document, layer.id);
          const siblingIndex = siblings.findIndex((sibling) => sibling.id === layer.id);
          const clippingBase = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
          const canToggleClipping = layer.clipping || Boolean(clippingBase);
          const { fontStatus, finding: capabilityFinding } = layerCompatibilityPresentation(
            layer, textFontDiagnostics, availableFonts, capabilityFindings
          );
          return (
          <React.Fragment key={layer.id}>
          <div
            data-layer-id={layer.id}
            draggable={!documentFx}
            {...layerTreeItemAccessibility(layer, depth, selectedLayerIds.has(layer.id), compositeLayerIsActive && document.activeLayerId === layer.id,
              layer.type === 'group' ? !collapsedGroups.has(layer.id) : undefined)}
            className={[
              'lighttable-layer',
              compositeLayerIsActive && document.activeLayerId === layer.id ? 'lighttable-layer--active' : '',
              selectedLayerIds.has(layer.id) ? 'lighttable-layer--selected' : '',
              editingTextLayerId === layer.id ? 'lighttable-layer--text-editing' : '',
              layer.clipping ? 'lighttable-layer--clipped' : '',
              draggedLayerId === layer.id ? 'lighttable-layer--dragging' : '',
              dropTarget?.layerId === layer.id ? `lighttable-layer--drop-${dropTarget.placement}` : ''
            ].filter(Boolean).join(' ')}
            style={{ paddingLeft: `${layerRowInset(depth)}px` }}
            onPointerDown={(event) => beginLayerPointerSelection(event, layer.id)}
            onClick={(event) => {
              if (clippingGestureLayerRef.current === layer.id) {
                clippingGestureLayerRef.current = null;
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              if (event.shiftKey || event.ctrlKey || event.metaKey) return;
              selectLayer(event, layer.id);
            }}
            onDoubleClick={(event) => {
              if (layer.type !== 'text') return;
              event.preventDefault();
              event.stopPropagation();
              if (layer.text.source.kind === 'flow') onEditText?.(layer.id);
            }}
            onKeyDown={(event) => handleLayerTreeKeyDown(event, layer)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!selectedLayerIds.has(layer.id)) {
                setSelectedLayerIds(new Set([layer.id]));
                selectionAnchorRef.current = layer.id;
                onSelect(layer.id);
                onChannelChange('pixels');
              }
              onInspectLayer(layer.id, 'pixels');
              setSubtargetMenu((current) => ({ ...current, open: false }));
              setMoreMenu({
                open: true,
                x: event.clientX,
                y: event.clientY,
                source: 'context'
              });
            }}
            onDragStart={(event) => {
              cancelLayerNameRenameGesture();
              if (documentFx) {
                event.preventDefault();
                return;
              }
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
              event.dataTransfer.effectAllowed = 'copyMove';
              event.dataTransfer.setData('application/x-lighttable-layer-id', layer.id);
              event.dataTransfer.setData('text/plain', layer.name);
            }}
            onDragOver={(event) => {
              const sourceId = draggedLayerIdRef.current;
              if (!sourceId || sourceId === layer.id || documentFx) return;
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
              setGroupDropActive(false);
              setDuplicateDropActive(false);
            }}
          >
            {canToggleClipping && !documentFx ? (
              <ButtonBase
                type="button"
                className={`lighttable-layer__clipping-boundary${
                  clippingBoundaryHoverLayerId === layer.id
                    ? ' lighttable-layer__clipping-boundary--active'
                    : ''
                }`}
                title={`${layer.clipping ? 'Release' : 'Create'} clipping mask: Alt/Option-click`}
                aria-label={`${layer.clipping ? 'Release' : 'Create'} clipping mask with Alt or Option click`}
                style={clippingBoundaryHoverLayerId === layer.id ? {
                  cursor: `url("${lightTableIcon('clipping_mask.png')}") 12 12, copy`
                } : undefined}
                onPointerEnter={(event) => {
                  if (event.altKey) setClippingBoundaryHoverLayerId(layer.id);
                }}
                onPointerMove={(event) => {
                  setClippingBoundaryHoverLayerId(event.altKey ? layer.id : null);
                }}
                onPointerLeave={() => {
                  setClippingBoundaryHoverLayerId((current) => current === layer.id ? null : current);
                }}
                onPointerDown={(event) => {
                  if (!event.altKey) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setClippingBoundaryHoverLayerId(null);
                  clippingGestureLayerRef.current = layer.id;
                  onClipping(layer.id, !layer.clipping);
                }}
              />
            ) : null}
            <ButtonBase
              type="button"
              className="lighttable-layer__visibility"
              onClick={(event) => {
                event.stopPropagation();
                onVisibility(selectionFor(layer.id), !layer.visible);
              }}
              aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
              title={layer.visible ? 'Hide layer' : 'Show layer'}
            ><img src={lightTableIcon(layer.visible ? 'visible.png' : 'visible_off.png')} alt="" /></ButtonBase>
            {layer.type === 'group' ? (
              <ButtonBase
                type="button"
                className={`lighttable-layer__disclosure${
                  collapsedGroups.has(layer.id) ? ' lighttable-layer__disclosure--collapsed' : ''
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  setCollapsedGroups((current) => {
                    const next = new Set(current);
                    if (next.has(layer.id)) next.delete(layer.id);
                    else next.add(layer.id);
                    return next;
                  });
                }}
                aria-label={collapsedGroups.has(layer.id) ? `Expand ${layer.name}` : `Collapse ${layer.name}`}
                title={collapsedGroups.has(layer.id) ? 'Expand group' : 'Collapse group'}
              >
                <img
                  src={lightTableIcon('chevron_layer.png')}
                  alt=""
                />
              </ButtonBase>
            ) : null}
            {layer.clipping ? (
              <span
                className="lighttable-layer__clipping-mark"
                title={`Clipped to ${clippingBase?.name ?? 'layer below'}`}
                aria-label={`Clipped to ${clippingBase?.name ?? 'layer below'}`}
              >
                <img src={lightTableIcon('clipping_mask.png')} alt="" aria-hidden="true" />
              </span>
            ) : null}
            <span className="lighttable-layer__thumbnail-slot">
              <ButtonBase
                type="button"
                style={thumbnailDimensions}
                className={[
                  'lighttable-layer__thumbnail',
                  layer.type === 'raster'
                    ? 'lighttable-layer__thumbnail--transparent'
                    : '',
                  compositeLayerIsActive && document.activeLayerId === layer.id && activeChannel === 'pixels'
                    ? 'lighttable-layer__thumbnail--active'
                    : ''
                ].filter(Boolean).join(' ')}
                onClick={(event) => {
                  if (layer.type === 'raster' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    event.stopPropagation();
                    onMaskIsolationChange(null);
                    onLoadTransparencySelection(layer.id);
                    return;
                  }
                  if (event.shiftKey) {
                    event.preventDefault();
                    event.stopPropagation();
                    onMaskIsolationChange(null);
                    selectLayer(event, layer.id, 'pixels');
                    return;
                  }
                  // Ordinary clicks are handled by the layer row. Keeping one
                  // selection path makes thumbnail and layer-name interaction
                  // behave identically.
                  onMaskIsolationChange(null);
                }}
                onDoubleClick={(event) => {
                  if (layer.type !== 'text' || layer.text.source.kind !== 'flow') return;
                  event.preventDefault();
                  event.stopPropagation();
                  onEditText?.(layer.id);
                }}
                title={
                  layer.type === 'raster'
                    ? 'Edit layer pixels; Ctrl/Cmd-click to load transparency as selection'
                    : layer.type === 'group'
                      ? 'Group'
                      : layer.type === 'text'
                        ? layer.text.source.kind === 'flow' ? 'Editable flow text' : 'Positioned text'
                        : layer.type === 'vector' ? 'Vector layer' : 'Adjustment layer'
                }
              >
                {previews?.pixels ? (
                  <img
                    className="lighttable-layer__thumbnail-preview"
                    src={previews.pixels.url}
                    width={previews.pixels.width}
                    height={previews.pixels.height}
                    alt=""
                  />
                ) : icon ? (
                  <img className="lighttable-layer__type-icon" src={icon} alt="" />
                ) : layer.type === 'text' ? (
                  <span className="lighttable-layer__text-icon" aria-hidden="true">T</span>
                ) : null}
              </ButtonBase>
            </span>
            {layer.mask ? (
              <>
                <ButtonBase
                  type="button"
                  className={`lighttable-layer__mask-link${layer.mask.linked ? ' lighttable-layer__mask-link--linked' : ''}`}
                  disabled={documentFx}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onMaskLinked(layer.id, !layer.mask!.linked);
                  }}
                  title={layer.mask.linked ? 'Unlink layer and mask' : 'Link layer and mask'}
                  aria-label={layer.mask.linked ? 'Unlink layer and mask' : 'Link layer and mask'}
                >
                  {layer.mask.linked ? (
                    <img src={lightTableIcon('link_vertical.png')} alt="" aria-hidden="true" />
                  ) : null}
                </ButtonBase>
                <span className="lighttable-layer__thumbnail-slot">
                <ButtonBase
                  type="button"
                  draggable={!documentFx}
                  disabled={documentFx}
                  style={thumbnailDimensions}
                  className={`lighttable-layer__thumbnail lighttable-layer__mask${compositeLayerIsActive && document.activeLayerId === layer.id && activeChannel === 'mask' ? ' lighttable-layer__thumbnail--active lighttable-layer__thumbnail--active-mask' : ''}${isolatedMaskLayerId === layer.id ? ' lighttable-layer__thumbnail--mask-isolated' : ''}${layer.mask.enabled ? '' : ' lighttable-layer__mask--disabled'}`}
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
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (!openMaskEditingOnDoubleClick) {
                      onToggleMask();
                      return;
                    }
                    selectLayer(event, layer.id, 'mask');
                    onMaskIsolationChange(layer.id);
                  }}
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
                  title={openMaskEditingOnDoubleClick
                    ? 'Edit mask; double-click to show it for editing; Alt-click to isolate; Ctrl/Cmd-click to load selection'
                    : layer.mask.enabled
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
                  ) : null}
                </ButtonBase>
                </span>
              </>
            ) : null}
            <input
              id={`lighttable-layer-name-${layer.id}`}
              key={`${layer.id}:${layer.name}`}
              className="lighttable-layer__name"
              defaultValue={layer.name}
              readOnly={renamingLayerId !== layer.id}
              tabIndex={renamingLayerId === layer.id ? 0 : -1}
              draggable={renamingLayerId !== layer.id && !documentFx}
              onPointerDown={() => {
                if (renamingLayerId === layer.id) return;
                onLayerNamePointerDown(layer.id, document.activeLayerId);
                layerNamePointerFocusRef.current = true;
                requestAnimationFrame(() => {
                  layerNamePointerFocusRef.current = false;
                });
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (renamingLayerId !== layer.id) {
                  if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
                    selectLayer(event, layer.id);
                  }
                }
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (!consumeLayerNameRenameGesture(layer.id)) return;
                layerNamePointerFocusRef.current = false;
                const input = event.currentTarget;
                input.blur();
                setRenamingLayerId(layer.id);
                requestAnimationFrame(() => {
                  input.focus();
                  input.select();
                });
              }}
              onFocus={() => {
                if (!layerNamePointerFocusRef.current) setRenamingLayerId(layer.id);
              }}
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
              {layer.type === 'text' ? (
                <>
                  <span
                    className="lighttable-layer__text-status"
                    title={layer.text.source.kind === 'positioned'
                      ? 'Positioned text preserves imported glyph placement; convert it before flow editing'
                      : 'Editable flow text rendered by WebGPU'}
                  >{layer.text.source.kind === 'positioned' ? 'Positioned' : 'Flow'}</span>
                  {editingTextLayerId === layer.id ? (
                    <span className="lighttable-layer__text-status lighttable-layer__text-status--editing">
                      Editing
                    </span>
                  ) : null}
                  {fontStatus && fontStatus.kind !== 'exact' ? (
                    <span
                      className={`lighttable-layer__text-status lighttable-layer__text-status--${fontStatus.kind}`}
                      role="button"
                      tabIndex={0}
                      aria-label={`${fontStatus.label}. Open font compatibility report`}
                      title={`${fontStatus.detail}. Open font compatibility report.`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onSelect(layer.id);
                        onChannelChange('pixels');
                        onOpenFontReport?.(layer.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        event.stopPropagation();
                        onSelect(layer.id);
                        onChannelChange('pixels');
                        onOpenFontReport?.(layer.id);
                      }}
                    >{fontStatus.label}</span>
                  ) : null}
                </>
              ) : null}
              {capabilityFinding && capabilityFinding.feature !== 'text-font' ? (
                <LayerCompatibilityBadge finding={capabilityFinding}
                  onOpen={() => onOpenFontReport?.(layer.id)} />
              ) : null}
              {hasStyles ? <span className="lighttable-layer__fx-mark" aria-label="Layer effects">fx</span> : null}
              {documentFx ? (
                <img
                  className="lighttable-layer__document-fx-lock"
                  src={lightTableIcon('lock_closed.png')}
                  alt="Fixed document-final position"
                  title="Document FX — fixed after layer compositing"
                />
              ) : null}
              {layerHasAnyLock(layer) ? (
                <img
                  className="lighttable-layer__lock"
                  src={lightTableIcon('lock_closed.png')}
                  alt="Layer has locked properties"
                  title={layer.locks.all ? 'Layer locked' : 'Some layer properties locked'}
                />
              ) : null}
            </span>
            {layer.type !== 'group' && hasExpandableChildren ? (
              <ButtonBase
                type="button"
                className={`lighttable-layer__disclosure lighttable-layer__disclosure--trailing${
                  childrenExpanded ? '' : ' lighttable-layer__disclosure--collapsed'
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  setCollapsedStyles((current) => {
                    const next = new Set(current);
                    if (next.has(layer.id)) next.delete(layer.id);
                    else next.add(layer.id);
                    return next;
                  });
                }}
                aria-label={childrenExpanded
                  ? `Collapse processing and effects for ${layer.name}`
                  : `Expand processing and effects for ${layer.name}`}
                title={childrenExpanded ? 'Collapse processing and effects' : 'Expand processing and effects'}
              >
                <img src={lightTableIcon('chevron_layer.png')} alt="" />
              </ButtonBase>
            ) : null}
          </div>
          {childrenExpanded ? (
            <div
              className="lighttable-layer-effects"
              style={{ paddingLeft: `${31 + depth * 16}px` }}
            >
              <LocalProcessingTreeRows
                layerId={layer.id}
                items={localProcessingItems}
                selectedOwner={inspectorTarget.kind === 'processing'
                  && inspectorTarget.layerId === layer.id
                  ? inspectorTarget.owner
                  : undefined}
                onEnabled={(layerId, owner, enabled) => {
                  if (owner === 'grade') onLocalGradeEnabled(layerId, enabled);
                  else if (owner === 'curves') onLocalCurvesEnabled(layerId, enabled);
                  else onLocalLensFxEnabled(layerId, enabled);
                }}
                onActivate={(owner) => {
                    onSelect(layer.id);
                    onChannelChange('pixels');
                    onInspectProcessing(layer.id, owner);
                }}
                onContextMenu={(event, owner) => {
                  onSelect(layer.id);
                  onChannelChange('pixels');
                  onInspectProcessing(layer.id, owner);
                  openSubtargetMenu(event, { kind: 'processing', layerId: layer.id, owner });
                }}
                onDragStart={(event, owner) => {
                  onSelect(layer.id);
                  onChannelChange('pixels');
                  onInspectProcessing(layer.id, owner);
                  beginSubtargetDrag(
                    event,
                    { kind: 'processing', layerId: layer.id, owner },
                    owner === 'lens-fx' ? 'Lens Fx' : owner === 'curves' ? 'Curves' : 'Grade'
                  );
                }}
              />
              <AttachedAdjustmentTreeRows
                layerId={layer.id}
                items={attachedAdjustmentItems}
                selectedId={inspectorTarget.kind === 'attached-processing'
                  && inspectorTarget.layerId === layer.id
                  ? inspectorTarget.adjustmentId
                  : undefined}
                onEnabled={onAttachedAdjustmentEnabled}
                onActivate={(adjustmentId) => {
                  onSelect(layer.id);
                  onChannelChange('pixels');
                  onInspectAttachedAdjustment(layer.id, adjustmentId);
                }}
                onContextMenu={(event, adjustmentId) => {
                  onSelect(layer.id);
                  onChannelChange('pixels');
                  onInspectAttachedAdjustment(layer.id, adjustmentId);
                  openSubtargetMenu(event, {
                    kind: 'attached-processing', layerId: layer.id, adjustmentId
                  });
                }}
                onDragStart={(event, adjustmentId, label) => {
                  onSelect(layer.id);
                  onChannelChange('pixels');
                  onInspectAttachedAdjustment(layer.id, adjustmentId);
                  beginSubtargetDrag(
                    event,
                    { kind: 'attached-processing', layerId: layer.id, adjustmentId },
                    label
                  );
                }}
              />
              {hasStyles ? (
                <>
                  <div className={`lighttable-layer-effect lighttable-layer-effect--summary${
                    inspectorTarget.kind === 'style-stack' && inspectorTarget.layerId === layer.id
                      ? ' lighttable-layer-effect--selected'
                      : ''
                  }`}
                    draggable
                    onContextMenu={(event) => {
                      onSelect(layer.id);
                      onChannelChange('pixels');
                      onEditStyles(layer.id);
                      openSubtargetMenu(event, { kind: 'style-stack', layerId: layer.id });
                    }}
                    onDragStart={(event) => {
                      onSelect(layer.id);
                      onChannelChange('pixels');
                      onEditStyles(layer.id);
                      beginSubtargetDrag(
                        event,
                        { kind: 'style-stack', layerId: layer.id },
                        'Effects'
                      );
                    }}>
                    <ButtonBase
                      type="button"
                      className="lighttable-layer-effect__visibility"
                      onClick={() => onStyleStackEnabled(layer.id, !layer.styleStack.enabled)}
                      title={layer.styleStack.enabled ? 'Hide all layer effects' : 'Show all layer effects'}
                      aria-label={layer.styleStack.enabled ? 'Hide all layer effects' : 'Show all layer effects'}
                    ><img src={lightTableIcon(layer.styleStack.enabled ? 'visible.png' : 'visible_off.png')} alt="" /></ButtonBase>
                    <ButtonBase type="button" onClick={() => {
                      onSelect(layer.id);
                      onChannelChange('pixels');
                      onEditStyles(layer.id);
                    }}>Effects</ButtonBase>
                  </div>
                  {[...visibleStyleEffects].reverse().map((effect) => (
                    <div className={`lighttable-layer-effect${
                      inspectorTarget.kind === 'style'
                        && inspectorTarget.layerId === layer.id
                        && inspectorTarget.effectId === effect.id
                        ? ' lighttable-layer-effect--selected'
                        : ''
                    }`} key={effect.id}
                      draggable
                      onContextMenu={(event) => {
                        onSelect(layer.id);
                        onChannelChange('pixels');
                        onEditStyles(layer.id, effect.id);
                        openSubtargetMenu(event, {
                          kind: 'style',
                          layerId: layer.id,
                          effectId: effect.id
                        });
                      }}
                      onDragStart={(event) => {
                        onSelect(layer.id);
                        onChannelChange('pixels');
                        onEditStyles(layer.id, effect.id);
                        beginSubtargetDrag(
                          event,
                          { kind: 'style', layerId: layer.id, effectId: effect.id },
                          effect.name
                        );
                      }}>
                      <ButtonBase
                        type="button"
                        className="lighttable-layer-effect__visibility"
                        onClick={() => onStyleEnabled(layer.id, effect.id, !effect.enabled)}
                        title={effect.enabled ? `Hide ${effect.name}` : `Show ${effect.name}`}
                        aria-label={effect.enabled ? `Hide ${effect.name}` : `Show ${effect.name}`}
                      ><img src={lightTableIcon(effect.enabled ? 'visible.png' : 'visible_off.png')} alt="" /></ButtonBase>
                      <ButtonBase type="button" onClick={() => {
                        onSelect(layer.id);
                        onChannelChange('pixels');
                        onEditStyles(layer.id, effect.id);
                      }}>{effect.name}</ButtonBase>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
          </React.Fragment>
          );
        })}
      </div>
      <footer className="lighttable-layers__footer">
        <ButtonBase
          type="button"
          className="lighttable-layers__fx-button"
          onClick={() => {
            if (activeLayer && layerSupportsLayerStyles(activeLayer)) onEditStyles(activeLayer.id);
          }}
          disabled={activeIsDocumentFx || !canEditActiveLayerStyles}
          title={activeIsDocumentFx
            ? 'Layer styles are not available for document-final effects'
            : canEditActiveLayerStyles ? 'Open layer effects' : 'Select a layer that supports effects'}
          aria-label="Add layer style"
        >fx</ButtonBase>
        <ButtonBase
          type="button"
          className={groupDropActive ? 'lighttable-layers__group--drop-active' : undefined}
          onClick={() => {
            if (selectedIds.length) onGroupSelection(selectedIds);
            else onCreateGroup();
          }}
          disabled={selectionContainsDocumentFx || (selectedIds.length > 0 && !canGroupSelection)}
          onDragEnter={(event) => {
            if (!Array.from(event.dataTransfer.types).includes(
              'application/x-lighttable-layer-id'
            ) || selectionContainsDocumentFx || !canGroupSelection) return;
            event.preventDefault();
            setGroupDropActive(true);
          }}
          onDragOver={(event) => {
            if (!Array.from(event.dataTransfer.types).includes(
              'application/x-lighttable-layer-id'
            ) || selectionContainsDocumentFx || !canGroupSelection) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setGroupDropActive(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setGroupDropActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const sourceLayerId = (
              draggedLayerIdRef.current
              ?? event.dataTransfer.getData('application/x-lighttable-layer-id')
            ) as LayerId;
            const layerIds = sourceLayerId && selectedLayerIds.has(sourceLayerId)
              ? selectedIds
              : sourceLayerId ? [sourceLayerId] : [];
            if (layerIds.length && queryLayerCommandCapabilities(
              document,
              layerIds
            ).canGroupSelection) onGroupSelection(layerIds);
            draggedLayerIdRef.current = null;
            setDraggedLayerId(null);
            setDropTarget(null);
            setGroupDropActive(false);
          }}
          title={selectedIds.length ? 'Group selected layers' : 'New group'}
          aria-label={selectedIds.length ? 'Group selected layers' : 'New group'}
        ><img src={lightTableIcon('add_group.png')} alt="" aria-hidden="true" /></ButtonBase>
        <ButtonBase
          type="button"
          onClick={onAddMask}
          disabled={
            !activeLayer
            || activeIsDocumentFx
            || activeLayer.type === 'group'
            || Boolean(activeLayer.mask)
          }
          title="Add layer mask"
          aria-label="Add layer mask"
        ><img src={lightTableIcon('add_mask.png')} alt="" aria-hidden="true" /></ButtonBase>
        <div
          className="lighttable-layers__create-menu"
        >
          <ButtonBase
            ref={createLayerMenuTriggerRef}
            type="button"
            className="lighttable-layers__create-menu-trigger"
            onClick={() => setCreateLayerMenuOpen((open) => !open)}
            title="New fill or processing layer"
            aria-label="New fill or processing layer"
            aria-haspopup="menu"
            aria-expanded={createLayerMenuOpen}
          ><img src={lightTableIcon('add_adjustment_layer.png')} alt="" aria-hidden="true" /></ButtonBase>
          {createLayerMenuOpen ? (
            <AnchoredViewportMenu
              anchor={createLayerMenuTriggerRef}
              className="lighttable-layers__create-flyout"
              ariaLabel="New fill or processing layer"
              onClose={closeCreateLayerMenu}
            >
              {LAYER_CREATION_OPTIONS.map((option) => (
                <div
                  className={`lighttable-layers__create-option${
                    option.sectionStart
                      ? ' lighttable-layers__create-option--section-start'
                      : ''
                  }`}
                  role="none"
                  key={option.id}
                >
                  <ButtonBase
                    className="lighttable-layers__create-layer"
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setCreateLayerMenuOpen(false);
                      layerCreationHandlers(option.id)();
                    }}
                    title={option.label}
                    aria-label={option.label}
                  >
                    <img src={lightTableIcon(option.iconName)} alt="" aria-hidden="true" />
                    <span>{option.menuLabel}</span>
                  </ButtonBase>
                  <ButtonBase
                      className="lighttable-layers__create-attached"
                      type="button"
                      role="menuitem"
                      disabled={activeLayer?.type !== 'raster' || activeLayer.locks.all}
                      onClick={() => {
                        if (activeLayer?.type !== 'raster') return;
                        setCreateLayerMenuOpen(false);
                        if (option.id === 'grade' || option.id === 'curves' || option.id === 'lens-fx') {
                          const kind: LocalProcessingKind = option.id === 'lens-fx'
                            ? 'lens-fx'
                            : option.id === 'curves' ? 'curves' : 'grade';
                          onCreateLocalProcessing(activeLayer.id, kind);
                          onInspectProcessing(activeLayer.id, kind);
                          return;
                        }
                        const adjustmentId = onCreateAttachedAdjustment(activeLayer.id, option.id);
                        if (adjustmentId) {
                          onInspectAttachedAdjustment(activeLayer.id, adjustmentId);
                        }
                      }}
                      title={`Attach ${option.menuLabel} to selected layer`}
                      aria-label={`Attach ${option.menuLabel} to selected layer`}
                    ><img src={lightTableIcon('link_vertical.png')} alt="" aria-hidden="true" /></ButtonBase>
                </div>
              ))}
            </AnchoredViewportMenu>
          ) : null}
        </div>
        <ButtonBase
          type="button"
          className={duplicateDropActive ? 'lighttable-layers__duplicate--drop-active' : undefined}
          onClick={onCreate}
          onDragEnter={(event) => {
            if (!Array.from(event.dataTransfer.types).includes(
              'application/x-lighttable-layer-id'
            )) return;
            event.preventDefault();
            setDuplicateDropActive(true);
          }}
          onDragOver={(event) => {
            if (!Array.from(event.dataTransfer.types).includes(
              'application/x-lighttable-layer-id'
            )) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setDuplicateDropActive(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setDuplicateDropActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const sourceLayerId = (
              draggedLayerIdRef.current
              ?? event.dataTransfer.getData('application/x-lighttable-layer-id')
            ) as LayerId;
            if (sourceLayerId) onDuplicate();
            draggedLayerIdRef.current = null;
            setDraggedLayerId(null);
            setDropTarget(null);
            setDuplicateDropActive(false);
          }}
          title="New raster layer"
          aria-label="New raster layer"
        ><img src={lightTableIcon('add_layer.png')} alt="" aria-hidden="true" /></ButtonBase>
        <ButtonBase
          type="button"
          className={trashDropActive ? 'lighttable-layers__trash--drop-active' : undefined}
          onClick={() => deleteTreeTarget(selectedDeleteTarget())}
          disabled={!activeLayer}
          onDragEnter={(event) => {
            const types = Array.from(event.dataTransfer.types);
            if (
              !types.includes('application/x-lighttable-layer-id')
              && !types.includes('application/x-lighttable-layer-mask-id')
              && !types.includes(LAYER_SUBTARGET_DRAG_TYPE)
            ) return;
            event.preventDefault();
            setTrashDropActive(true);
          }}
          onDragOver={(event) => {
            const types = Array.from(event.dataTransfer.types);
            if (
              !types.includes('application/x-lighttable-layer-id')
              && !types.includes('application/x-lighttable-layer-mask-id')
              && !types.includes(LAYER_SUBTARGET_DRAG_TYPE)
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
              deleteTreeTarget({ kind: 'mask', layerId: maskLayerId });
            } else {
              const subtarget = parseLayerSubtarget(
                event.dataTransfer.getData(LAYER_SUBTARGET_DRAG_TYPE)
              );
              if (subtarget) {
                deleteTreeTarget(subtarget);
              } else {
                const sourceLayerId = (
                  draggedLayerIdRef.current
                  ?? event.dataTransfer.getData('application/x-lighttable-layer-id')
                ) as LayerId;
                if (sourceLayerId) {
                  onDelete(selectedLayerIds.has(sourceLayerId) ? selectedIds : [sourceLayerId]);
                }
              }
            }
            draggedLayerIdRef.current = null;
            setDraggedLayerId(null);
            setDropTarget(null);
            setTrashDropActive(false);
          }}
          title="Delete selected layer item"
          aria-label="Delete selected layer item"
        ><img src={lightTableIcon('layer_trash.png')} alt="" aria-hidden="true" /></ButtonBase>
        <ButtonBase
          type="button"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            setSubtargetMenu((current) => ({ ...current, open: false }));
            setMoreMenu({
              open: true,
              x: bounds.right,
              y: bounds.top,
              source: 'footer'
            });
          }}
          title="Layers menu"
          aria-label="Layers menu"
        ><img src={lightTableIcon('more_menu.png')} alt="" aria-hidden="true" /></ButtonBase>
      </footer>
      <ContextMenu
        open={moreMenu.open}
        x={moreMenu.x}
        y={moreMenu.y}
        onClose={() => setMoreMenu((current) => ({ ...current, open: false }))}
        options={moreMenuOptions}
      />
      <ContextMenu
        open={subtargetMenu.open}
        x={subtargetMenu.x}
        y={subtargetMenu.y}
        onClose={() => setSubtargetMenu((current) => ({ ...current, open: false }))}
        options={subtargetMenuOptions}
      />
    </section>
  );
};
