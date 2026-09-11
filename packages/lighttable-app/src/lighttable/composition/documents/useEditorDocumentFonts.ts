import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { DocumentSession } from '../../application/documents/documentSession';
import { DocumentFontHydrationOwner } from '../../application/documents/DocumentFontHydrationOwner';
import { DocumentFontRegistry } from '../../text/fonts/DocumentFontRegistry';
import { FontationsFontFaceParser } from '../../text/fonts/FontationsFontFaceParser';

/** Session fonts survive tab unmount. Only the embedded host owns local fonts. */
export const createEditorDocumentFontRuntime = (session?: DocumentSession) => {
    const registry = session?.fonts ?? new DocumentFontRegistry({ parser: new FontationsFontFaceParser() });
    const hydration = session?.fontHydration ?? new DocumentFontHydrationOwner(registry);
    let connectionGeneration = 0;
    return {
      registry, hydration,
      subscribe: (listener: () => void) => registry.subscribeAvailability(listener),
      getRevision: () => registry.availabilityRevision,
      resetForOpen: () => {
        if (session) return; // A rebind never destroys document-owned fonts.
        hydration.reset();
        registry.reset();
      },
      connect: () => {
        connectionGeneration++;
        return () => {
          const closingGeneration = ++connectionGeneration;
          // StrictMode setup/cleanup/setup retains the same committed resource.
          queueMicrotask(() => {
            if (session || closingGeneration !== connectionGeneration) return;
            hydration.dispose();
            registry.dispose();
          });
        };
      }
    };
};

export const useEditorDocumentFonts = (session: DocumentSession | undefined, workspaceId: string) => {
  const runtime = useMemo(() => createEditorDocumentFontRuntime(session), [session, workspaceId]);
  useEffect(runtime.connect, [runtime]);
  const availabilityRevision = useSyncExternalStore(runtime.subscribe, runtime.getRevision, runtime.getRevision);
  return { ...runtime, availabilityRevision };
};
