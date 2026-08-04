import React, { useEffect } from 'react';
import type { LayerStyleEditorController } from '../../application/styles/useLayerStyleEditorController';
import type { ImageDocument } from '../document/documentTypes';
import { findDocumentLayer } from '../document/layerTree';
import { layerSupportsLayerStyles } from '../document/documentTypes';
import { LayerStyleEditor } from '../ui/LayerStyleEditor';

export interface LayerStylesPanelProps {
  document: ImageDocument | null;
  controller: LayerStyleEditorController;
}

/** Contextual, dockable layer-effects inspector for the active layer. */
export const LayerStylesPanel: React.FC<LayerStylesPanelProps> = ({ document, controller }) => {
  const activeLayer = document?.activeLayerId
    ? findDocumentLayer(document, document.activeLayerId)
    : null;
  const supportedLayer = activeLayer && layerSupportsLayerStyles(activeLayer)
    ? activeLayer
    : null;

  useEffect(() => {
    if (supportedLayer && controller.request?.layerId !== supportedLayer.id) {
      controller.open(supportedLayer.id);
    } else if (!supportedLayer && controller.request) {
      controller.commit();
    }
  }, [controller, supportedLayer]);

  const request = controller.request;
  const target = request && document
    ? findDocumentLayer(document, request.layerId)
    : supportedLayer;

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
        initialEffectId={request?.layerId === target.id ? request.effectId : undefined}
        onPreview={controller.preview}
      />
    </aside>
  );
};
