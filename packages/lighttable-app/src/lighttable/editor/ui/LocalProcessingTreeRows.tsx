import React from 'react';
import { lightTableIcon } from '../../../assets/icons';
import type { AttachedAdjustment, LayerId, LayerNode } from '../document/documentTypes';
import {
  adjustmentStackHasLocalProcessing,
  adjustmentStackLocalProcessingIsEnabled,
  type LocalProcessingKind
} from '../../processing/adjustmentStack';
import { adjustmentLayerDefinition } from '../../processing/adjustmentLayerCatalog';

export interface LocalProcessingTreeItem {
  readonly id: LocalProcessingKind;
  readonly label: 'Grade' | 'Curves' | 'Lens Fx';
  readonly enabled: boolean;
}

export const localProcessingTreeItems = (layer: LayerNode): readonly LocalProcessingTreeItem[] => {
  if (layer.type !== 'raster' || !layer.adjustmentStack) return [];
  const items: LocalProcessingTreeItem[] = [];
  if (adjustmentStackHasLocalProcessing(layer.adjustmentStack, 'grade')) {
    items.push({
      id: 'grade',
      label: 'Grade',
      enabled: adjustmentStackLocalProcessingIsEnabled(layer.adjustmentStack, 'grade')
    });
  }
  if (adjustmentStackHasLocalProcessing(layer.adjustmentStack, 'curves')) {
    items.push({
      id: 'curves',
      label: 'Curves',
      enabled: adjustmentStackLocalProcessingIsEnabled(layer.adjustmentStack, 'curves')
    });
  }
  if (adjustmentStackHasLocalProcessing(layer.adjustmentStack, 'lens-fx')) {
    items.push({
      id: 'lens-fx',
      label: 'Lens Fx',
      enabled: adjustmentStackLocalProcessingIsEnabled(layer.adjustmentStack, 'lens-fx')
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
        src={lightTableIcon(item.id === 'lens-fx' ? 'lens_fx.png' : 'layer_adjustment.png')}
        alt=""
        aria-hidden="true"
      />
      {item.label}
    </button>
  </div>
));

export const AttachedAdjustmentTreeRows: React.FC<{
  readonly layerId: LayerId;
  readonly items: readonly AttachedAdjustment[];
  readonly selectedId?: string;
  readonly onActivate: (adjustmentId: string) => void;
  readonly onContextMenu: (event: React.MouseEvent<HTMLDivElement>, adjustmentId: string) => void;
  readonly onDragStart: (event: React.DragEvent<HTMLDivElement>, adjustmentId: string, label: string) => void;
  readonly onEnabled: (layerId: LayerId, adjustmentId: string, enabled: boolean) => void;
}> = ({ layerId, items, selectedId, onActivate, onContextMenu, onDragStart, onEnabled }) => (
  items.map((item) => {
    const definition = adjustmentLayerDefinition(item.adjustmentKind);
    return (
      <div
        className={`lighttable-layer-effect lighttable-layer-effect--local-processing${
          selectedId === item.id ? ' lighttable-layer-effect--selected' : ''
        }`}
        key={item.id}
        draggable
        onContextMenu={(event) => onContextMenu(event, item.id)}
        onDragStart={(event) => onDragStart(event, item.id, item.name)}
      >
        <button
          type="button"
          className="lighttable-layer-effect__visibility"
          onClick={() => onEnabled(layerId, item.id, !item.enabled)}
          title={`${item.enabled ? 'Disable' : 'Enable'} attached ${item.name}`}
          aria-label={`${item.enabled ? 'Disable' : 'Enable'} attached ${item.name}`}
        ><img src={lightTableIcon(item.enabled ? 'visible.png' : 'visible_off.png')} alt="" /></button>
        <button type="button" onClick={() => onActivate(item.id)} aria-pressed={selectedId === item.id}>
          <img
            className="lighttable-layer-effect__processing-icon"
            src={lightTableIcon(definition.iconName)}
            alt=""
            aria-hidden="true"
          />
          {item.name}
        </button>
      </div>
    );
  })
);
