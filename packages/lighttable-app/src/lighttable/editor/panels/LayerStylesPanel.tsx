import React from 'react';
import type { LayerStyleEditorController } from '../../application/styles/useLayerStyleEditorController';
import type { ImageDocument, LayerId } from '../document/documentTypes';
import { findDocumentLayer, walkLayerTree } from '../document/layerTree';
import { layerSupportsLayerStyles } from '../document/documentTypes';
import { LayerStyleEditor } from '../ui/LayerStyleEditor';
import type { LayerStyleStack } from '../styles/layerStyleTypes';

export interface LayerStylesPanelProps {
  document: ImageDocument | null;
  controller: LayerStyleEditorController;
}

export const layerStylePreviewIntervalForLayerCount = (layerCount: number) =>
  layerCount > 32 ? 100 : 33;

export const previewLayerStyleFromPanel = (
  controller: LayerStyleEditorController,
  layerId: LayerId,
  stack: LayerStyleStack
) => {
  if (controller.request?.layerId !== layerId) controller.open(layerId);
  controller.preview(stack);
};

/** Contextual, dockable layer-effects inspector for the active layer. */
export const LayerStylesPanel: React.FC<LayerStylesPanelProps> = ({ document, controller }) => {
  const activeLayer = document?.activeLayerId
    ? findDocumentLayer(document, document.activeLayerId)
    : null;
  const request = controller.request;
  const requestedLayer = document && request
    ? findDocumentLayer(document, request.layerId)
    : null;
  const supportedLayer = activeLayer && layerSupportsLayerStyles(activeLayer)
    ? activeLayer
    : null;

  // A child effect click carries an explicit owner. Prefer it over a possibly
  // one-render-stale active layer while the Layers selection is publishing.
  const target = requestedLayer && layerSupportsLayerStyles(requestedLayer)
    ? requestedLayer
    : supportedLayer;
  const layerCount = document ? walkLayerTree(document.layers).length : 0;
  // Large PSDs can spend around 100 ms evaluating one styled correction frame.
  // Keep the inspector native-rate while handing only the newest snapshot to
  // those documents. Small documents retain the normal 30 Hz live preview.
  const previewIntervalMs = layerStylePreviewIntervalForLayerCount(layerCount);

  if (!target || !layerSupportsLayerStyles(target)) {
    return (
      <aside className="lighttable-panel lighttable-layer-styles-panel" aria-label="Layer effects">
        <div className="lighttable-panel__empty">Select a layer that supports effects.</div>
      </aside>
    );
  }

  return (
    <aside className="lighttable-panel lighttable-layer-styles-panel" aria-label="Layer effects">
      <LayerStyleEditor
        key={target.id}
        mode="panel"
        layerName={target.name}
        initialStack={target.styleStack}
        previewIntervalMs={previewIntervalMs}
        initialEffectId={request?.layerId === target.id ? request.effectId : undefined}
        onPreview={(stack) => {
          // Merely mounting or revealing the persistent Effects tab must not
          // start a document transaction. Open it lazily on the first authored
          // change so unrelated tool gestures cannot be absorbed into style
          // history while the panel sits in the background.
          previewLayerStyleFromPanel(controller, target.id, stack);
        }}
      />
    </aside>
  );
};
