import React from 'react';
import { lightTableIcon } from '../../../assets/icons';
import type { LayerId, LayerNode } from '../document/documentTypes';
import {
  adjustmentStackHasOwner,
  adjustmentStackOwnerIsEnabled
} from '../../processing/adjustmentStack';

export interface LocalProcessingTreeItem {
  readonly id: 'grade' | 'lens-fx';
  readonly label: 'Grade' | 'Lens Fx';
  readonly enabled: boolean;
}

export const localProcessingTreeItems = (layer: LayerNode): readonly LocalProcessingTreeItem[] => {
  if (layer.type !== 'raster' || !layer.adjustmentStack) return [];
  const items: LocalProcessingTreeItem[] = [];
  if (adjustmentStackHasOwner(layer.adjustmentStack, 'grade')) {
    items.push({
      id: 'grade',
      label: 'Grade',
      enabled: adjustmentStackOwnerIsEnabled(layer.adjustmentStack, 'grade')
    });
  }
  if (adjustmentStackHasOwner(layer.adjustmentStack, 'lens-fx')) {
    items.push({
      id: 'lens-fx',
      label: 'Lens Fx',
      enabled: adjustmentStackOwnerIsEnabled(layer.adjustmentStack, 'lens-fx')
    });
  }
  return items;
};

export const LocalProcessingTreeRows: React.FC<{
  readonly layerId: LayerId;
  readonly items: readonly LocalProcessingTreeItem[];
  readonly selectedOwner?: LocalProcessingTreeItem['id'];
  readonly onActivate: (owner: LocalProcessingTreeItem['id']) => void;
  readonly onContextMenu: (
    event: React.MouseEvent<HTMLDivElement>,
    owner: LocalProcessingTreeItem['id']
  ) => void;
  readonly onDragStart: (
    event: React.DragEvent<HTMLDivElement>,
    owner: LocalProcessingTreeItem['id']
  ) => void;
  readonly onEnabled: (
    layerId: LayerId,
    owner: LocalProcessingTreeItem['id'],
    enabled: boolean
  ) => void;
}> = ({
  layerId,
  items,
  selectedOwner,
  onActivate,
  onContextMenu,
  onDragStart,
  onEnabled
}) => items.map((item) => (
  <div
    className={`lighttable-layer-effect lighttable-layer-effect--local-processing${
      selectedOwner === item.id ? ' lighttable-layer-effect--selected' : ''
    }`}
    key={item.id}
    draggable
    onContextMenu={(event) => onContextMenu(event, item.id)}
    onDragStart={(event) => onDragStart(event, item.id)}
  >
    <button
      type="button"
      className="lighttable-layer-effect__visibility"
      onClick={() => onEnabled(layerId, item.id, !item.enabled)}
      title={`${item.enabled ? 'Disable' : 'Enable'} local ${item.label}`}
      aria-label={`${item.enabled ? 'Disable' : 'Enable'} local ${item.label}`}
    ><img src={lightTableIcon(item.enabled ? 'visible.png' : 'visible_off.png')} alt="" /></button>
    <button type="button" onClick={() => onActivate(item.id)} aria-pressed={selectedOwner === item.id}>
      <img
        className="lighttable-layer-effect__processing-icon"
        src={lightTableIcon(item.id === 'grade' ? 'layer_adjustment.png' : 'lens_fx.png')}
        alt=""
        aria-hidden="true"
      />
      {item.label}
    </button>
  </div>
));
