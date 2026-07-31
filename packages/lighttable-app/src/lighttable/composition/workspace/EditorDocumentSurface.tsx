import React from 'react';
import {
  DocumentViewportSurface,
  type DocumentViewportSurfaceProps
} from '../../editor/ui/DocumentViewportSurface';
import {
  EditorStatusBar,
  type EditorStatusBarProps
} from '../../editor/ui/EditorStatusBar';

export interface EditorDocumentSurfaceProps {
  viewport: DocumentViewportSurfaceProps;
  status: EditorStatusBarProps;
}

/**
 * The complete visual surface for one document tab.
 *
 * Document-session orchestration stays outside; canvas interaction and status
 * presentation stay together so every workspace document gets the same host.
 */
export const EditorDocumentSurface: React.FC<EditorDocumentSurfaceProps> = ({
  viewport,
  status
}) => (
  <section className="lighttable__main">
    <DocumentViewportSurface {...viewport} />
    <EditorStatusBar {...status} />
  </section>
);
