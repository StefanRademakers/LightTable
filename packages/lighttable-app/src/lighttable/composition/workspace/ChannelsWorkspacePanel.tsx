import { ButtonBase } from '../../../ui/ButtonBase';
import React, { useMemo } from 'react';
import { lightTableIcon } from '../../../assets/icons';
import type {
  ImageDocument,
  LayerId
} from '../../editor/document/documentTypes';
import { walkLayerTree } from '../../editor/document/layerTree';
import type {
  LayerThumbnailSet
} from '../../editor/layers/layerThumbnailTypes';
import type {
  CompositeColorChannel,
  CompositeSelectionChannel
} from '../../editor/selection/selectionTypes';

export interface ChannelsWorkspacePanelProps {
  document: ImageDocument | null;
  thumbnails: ReadonlyMap<LayerId, LayerThumbnailSet>;
  isolatedCompositeChannel: CompositeColorChannel | null;
  isolatedMaskLayerId: LayerId | null;
  onCompositeChannelIsolationChange(channel: CompositeColorChannel | null): void;
  onMaskIsolationChange(layerId: LayerId | null): void;
  onSelectCompositeChannel(channel: CompositeSelectionChannel): void;
  onSelectLayerMask(layerId: LayerId): void;
}

interface ColorChannelDefinition {
  id: CompositeSelectionChannel;
  label: string;
}

const COLOR_CHANNELS: readonly ColorChannelDefinition[] = [
  { id: 'composite', label: 'Composite' },
  { id: 'red', label: 'Red' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' }
];

/**
 * Presents reconstructed document channels without owning channel state.
 * Ctrl/Cmd-click converts the thumbnail to a selection; a regular click only
 * changes the diagnostic viewport isolation.
 */
export const ChannelsWorkspacePanel: React.FC<ChannelsWorkspacePanelProps> = ({
  document,
  thumbnails,
  isolatedCompositeChannel,
  isolatedMaskLayerId,
  onCompositeChannelIsolationChange,
  onMaskIsolationChange,
  onSelectCompositeChannel,
  onSelectLayerMask
}) => {
  const masks = useMemo(() => (
    document
      ? walkLayerTree(document.layers)
        .filter(({ node }) => Boolean(node.mask))
        .map(({ node }) => ({ id: node.id, name: node.name }))
      : []
  ), [document]);

  if (!document) {
    return (
      <div className="lighttable-channels-panel lighttable-channels-panel--empty">
        No document channels
      </div>
    );
  }

  const isolateColorChannel = (channel: CompositeSelectionChannel) => {
    onMaskIsolationChange(null);
    onCompositeChannelIsolationChange(channel === 'composite' ? null : channel);
  };

  const isolateMask = (layerId: LayerId) => {
    onCompositeChannelIsolationChange(null);
    onMaskIsolationChange(layerId);
  };

  return (
    <div className="lighttable-channels-panel">
      <div className="lighttable-channels-panel__list" role="list">
        {COLOR_CHANNELS.map((channel) => {
          const active = channel.id === 'composite'
            ? !isolatedCompositeChannel && !isolatedMaskLayerId
            : isolatedCompositeChannel === channel.id && !isolatedMaskLayerId;
          return (
            <ButtonBase
              className={`lighttable-channel-row${active ? ' lighttable-channel-row--active' : ''}`}
              key={channel.id}
              onClick={(event) => {
                if (event.ctrlKey || event.metaKey) {
                  onSelectCompositeChannel(channel.id);
                  return;
                }
                isolateColorChannel(channel.id);
              }}
              role="listitem"
              title={`View ${channel.label} channel. Ctrl/Cmd-click to load as selection.`}
              type="button"
            >
              <span className="lighttable-channel-row__visibility" aria-hidden="true">
                <img src={lightTableIcon(active ? 'visible.png' : 'visible_off.png')} alt="" />
              </span>
              <span
                className={`lighttable-channel-row__thumbnail lighttable-channel-row__thumbnail--${channel.id}`}
                aria-hidden="true"
              />
              <span className="lighttable-channel-row__label">{channel.label}</span>
            </ButtonBase>
          );
        })}
        {masks.length ? (
          <div className="lighttable-channels-panel__section-label">Alpha masks</div>
        ) : null}
        {masks.map((mask) => {
          const preview = thumbnails.get(mask.id)?.mask;
          const active = isolatedMaskLayerId === mask.id;
          return (
            <ButtonBase
              className={`lighttable-channel-row${active ? ' lighttable-channel-row--active' : ''}`}
              key={mask.id}
              onClick={(event) => {
                if (event.ctrlKey || event.metaKey) {
                  onSelectLayerMask(mask.id);
                  return;
                }
                isolateMask(mask.id);
              }}
              role="listitem"
              title={`View ${mask.name} mask. Ctrl/Cmd-click to load as selection.`}
              type="button"
            >
              <span className="lighttable-channel-row__visibility" aria-hidden="true">
                <img src={lightTableIcon(active ? 'visible.png' : 'visible_off.png')} alt="" />
              </span>
              <span className="lighttable-channel-row__thumbnail">
                {preview ? <img alt="" src={preview.url} /> : null}
              </span>
              <span className="lighttable-channel-row__label">{mask.name} Mask</span>
            </ButtonBase>
          );
        })}
      </div>
    </div>
  );
};
