import React from 'react';
import {
  EditorDialogs,
  type EditorDialogsProps
} from '../../editor/ui/EditorDialogs';
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
  onToolChange: (tool: ToolOptionsProps['activeTool']) => void;
}

export interface EditorOverlayLayerProps {
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
  dialogs,
  toolOptions
}) => {
  return (
    <>
      <EditorDialogs {...dialogs} />
      {toolOptions ? <ToolOptionsContextMenu {...toolOptions} /> : null}
    </>
  );
};
