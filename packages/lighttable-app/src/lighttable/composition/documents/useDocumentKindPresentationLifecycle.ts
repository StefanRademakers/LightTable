import { useEffect, useRef } from 'react';

export type PresentedDocumentKind = 'image' | 'video' | 'model-3d';

export interface DocumentKindPresentationPorts {
  clearImageDocument(): void;
  clearImageMetadata(): void;
  clearImageSource(): void;
  clearTemporaryTool(): void;
  clearTransientModifiers(): void;
}

/** Retires image-only and transient tool presentation when the workspace target changes. */
export const useDocumentKindPresentationLifecycle = (
  documentId: string,
  documentKind: PresentedDocumentKind,
  ports: DocumentKindPresentationPorts
): void => {
  const portsRef = useRef(ports);
  portsRef.current = ports;

  useEffect(() => {
    portsRef.current.clearTemporaryTool();
    portsRef.current.clearTransientModifiers();
  }, [documentId]);

  useEffect(() => {
    if (documentKind === 'image') return;
    portsRef.current.clearImageDocument();
    portsRef.current.clearImageMetadata();
    portsRef.current.clearImageSource();
  }, [documentKind]);
};
