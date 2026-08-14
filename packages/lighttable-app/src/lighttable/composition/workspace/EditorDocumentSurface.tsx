import React from 'react';
import {
  DocumentViewportSurface,
  type DocumentViewportSurfaceProps
} from '../../editor/ui/DocumentViewportSurface';

export interface EditorDocumentSurfaceProps {
  viewport: DocumentViewportSurfaceProps;
}

/**
 * The complete visual surface for one document tab.
 *
 * Document-session orchestration and workspace chrome stay outside. This
 * surface owns only the active document viewport so workspace-wide chrome can
 * span docked columns without unmounting document state.
 */
export const EditorDocumentSurface: React.FC<EditorDocumentSurfaceProps> = ({
  viewport
}) => (
  <section className="lighttable__main">
    <DocumentViewportSurface {...viewport} />
  </section>
);
