import React from 'react';
import type {
  LayerStyleEditorController
} from '../../application/styles/useLayerStyleEditorController';
import type {
  ImageDocument
} from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  EditorDialogs,
  type EditorDialogsProps
} from '../../editor/ui/EditorDialogs';
import { LayerStyleEditor } from '../../editor/ui/LayerStyleEditor';
import {
  ToolOptionsContextMenu
} from '../../editor/ui/ToolOptionsContextMenu';
import type {
  ToolOptionsProps
} from '../../editor/ui/ToolOptionsBar';

export interface ToolOptionsMenuBinding extends ToolOptionsProps {
  x: number;
  y: number;
  onClose: () => void;
}

export interface EditorOverlayLayerProps {
  document: ImageDocument | null;
  layerStyles: LayerStyleEditorController;
  dialogs: EditorDialogsProps;
  toolOptions: ToolOptionsMenuBinding | null;
}

/**
 * Hosts editor-global transient UI without owning document mutations.
 *
 * Dialogs and menus consume document-scoped controllers, so switching tabs or
 * closing a document can replace the bindings without leaving stale mutation
 * callbacks mounted in the application shell.
 */
export const EditorOverlayLayer: React.FC<EditorOverlayLayerProps> = ({
  document,
  layerStyles,
  dialogs,
  toolOptions
}) => {
  const request = layerStyles.request;
  const styleLayer = request && document
    ? findDocumentLayer(document, request.layerId)
    : null;

  return (
    <>
      {request && styleLayer?.type === 'raster' ? (
        <div className="lighttable-style-editor-shield">
          <LayerStyleEditor
            key={`${request.layerId}:${request.before.revision}`}
            layerName={styleLayer.name}
            initialStack={styleLayer.styleStack}
            initialEffectId={request.effectId}
            onPreview={layerStyles.preview}
            onCancel={layerStyles.cancel}
            onCommit={layerStyles.commit}
          />
        </div>
      ) : null}
      <EditorDialogs {...dialogs} />
      {toolOptions ? <ToolOptionsContextMenu {...toolOptions} /> : null}
    </>
  );
};
