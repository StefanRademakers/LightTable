import { useCallback, type Dispatch, type KeyboardEvent, type MutableRefObject, type SetStateAction } from 'react';
import type { LayerId, LayerNode } from '../../editor/document/documentTypes';

interface LayerTreeKeyboardOptions {
  readonly rows: readonly { readonly layer: LayerNode }[];
  readonly selectionFor: (layerId: LayerId) => LayerId[];
  readonly setSelected: Dispatch<SetStateAction<Set<LayerId>>>;
  readonly selectionAnchor: MutableRefObject<LayerId | null>;
  readonly activate: (layerId: LayerId) => void;
  readonly toggleVisibility: (layerIds: LayerId[], visible: boolean) => void;
  readonly beginRename: (layerId: LayerId) => void;
  readonly editText?: (layerId: LayerId) => void;
  readonly openContextMenu: (x: number, y: number) => void;
}

export const layerTreeItemAccessibility = (
  layer: LayerNode, depth: number, selected: boolean, active: boolean, expanded: boolean | undefined
) => ({
  role: 'treeitem' as const, 'aria-level': depth + 1, 'aria-selected': selected,
  'aria-expanded': expanded, 'aria-label': `${layer.name}, ${layer.type} layer${layer.visible ? '' : ', hidden'}`,
  tabIndex: active ? 0 : -1
});

export const useLayerTreeKeyboardNavigation = ({
  rows, selectionFor, setSelected, selectionAnchor, activate, toggleVisibility,
  beginRename, editText, openContextMenu
}: LayerTreeKeyboardOptions) => useCallback((event: KeyboardEvent<HTMLDivElement>, layer: LayerNode) => {
  if (event.target !== event.currentTarget) return;
  const currentIndex = rows.findIndex(({ layer: rowLayer }) => rowLayer.id === layer.id);
  if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
      : Math.max(0, Math.min(rows.length - 1, currentIndex + (event.key === 'ArrowDown' ? 1 : -1)));
    const target = rows[nextIndex]?.layer;
    if (!target) return;
    setSelected(new Set([target.id]));
    selectionAnchor.current = target.id;
    activate(target.id);
    requestAnimationFrame(() => document
      .querySelector<HTMLElement>(`.lighttable-layer[data-layer-id="${target.id}"]`)?.focus());
    return;
  }
  if (event.key === ' ') {
    event.preventDefault();
    toggleVisibility(selectionFor(layer.id), !layer.visible);
  } else if (event.key === 'F2') {
    event.preventDefault();
    beginRename(layer.id);
  } else if (event.key === 'Enter' && layer.type === 'text' && layer.text.source.kind === 'flow') {
    event.preventDefault();
    editText?.(layer.id);
  } else if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    openContextMenu(bounds.left + 24, bounds.top + 24);
  }
}, [activate, beginRename, editText, openContextMenu, rows, selectionAnchor, selectionFor, setSelected, toggleVisibility]);
