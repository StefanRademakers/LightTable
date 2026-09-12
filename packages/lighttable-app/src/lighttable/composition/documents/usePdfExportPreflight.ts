import { useLayoutEffect, useMemo, useRef } from 'react';
import type { DocumentFileIntents } from '../../application/documents/DocumentFileIntents';
import type { DocumentSession } from '../../application/documents/documentSession';
import { createPdfExportPreflightSession, type PdfExportPreflightSource } from '../../application/pdf/PdfExportPreflightSession';
import type { PdfExportServices } from '../../application/pdf/PdfExportServices';
import type { PdfExportPreflightRequest } from '../../editor/pdf/PdfExportPreflightDialog';
import type { DocumentRendererPort } from '../../infrastructure/rendering/webGpuDocumentRenderer';

export interface PdfExportPreflightBindingPorts {
  readonly fileIntents: Pick<DocumentFileIntents, 'prepareForUi'>;
  getSession(): DocumentSession | null | undefined;
  getRenderer(): (PdfExportPreflightSource['renderer'] & Pick<DocumentRendererPort,
    'synchronizeDocumentForExport' | 'waitForTextSourcesForExport'>) | null;
  getFonts(): PdfExportPreflightSource['fonts'];
  getFileName(): string;
  captureScope(): { isCurrent(): boolean };
  deliver(file: File): Promise<void>;
  openDialog(request: PdfExportPreflightRequest): void;
  reportError(message: string): void;
}

const services: PdfExportServices = {
  materializeFonts: async (plan, source) => (await import('../../infrastructure/pdf/materializePdfFontsWithHarfBuzz'))
    .materializePdfFontsWithHarfBuzz(plan, source),
  writeText: async input => (await import('../../infrastructure/pdf/writeNativeTextPdfPage')).writeNativeTextPdfPage(input),
  writeVector: async input => (await import('../../infrastructure/pdf/writePdfDisplayListPage')).writePdfDisplayListPage(input),
  writeRaster: async input => (await import('../../infrastructure/pdf/writeRasterPdfPage')).writeRasterPdfPage(input)
};

/** Request-time capture avoids retaining the initial render's not-yet-created GPU renderer. */
export const usePdfExportPreflight = (ports: PdfExportPreflightBindingPorts) => {
  const latest = useRef(ports); latest.current = ports;
  const lifetime = useRef({ mounted: false, request: 0 });
  useLayoutEffect(() => {
    lifetime.current.mounted = true;
    return () => { lifetime.current.mounted = false; lifetime.current.request++; };
  }, []);
  return useMemo(() => async () => {
    const opening = latest.current;
    const request = ++lifetime.current.request;
    const session = opening.getSession();
    const renderer = opening.getRenderer();
    const fonts = opening.getFonts();
    const fileName = opening.getFileName();
    const scope = opening.captureScope();
    const isCurrent = () => Boolean(session && renderer && lifetime.current.mounted && lifetime.current.request === request
      && latest.current.getSession() === session && latest.current.getRenderer() === renderer
      && latest.current.getFonts() === fonts && scope.isCurrent()
      && session.getSnapshot().lifecycle === 'ready');
    try {
      if (!isCurrent()) return;
      const prepared = await opening.fileIntents.prepareForUi();
      if (!isCurrent() || prepared.session !== session || prepared.renderer !== renderer) return;
      const snapshot = prepared.session.getSnapshot();
      if (!snapshot.document) throw new Error('LightTable is not ready yet.');
      // File terminals can commit in this event turn, ahead of React's projection.
      // Use the same exact canonical-to-export synchronization as PSD export.
      renderer!.synchronizeDocumentForExport(snapshot.document);
      const textReady = await renderer!.waitForTextSourcesForExport();
      if (!isCurrent()) return;
      prepared.assertCurrent();
      if (prepared.session.getSnapshot().documentRevision !== snapshot.documentRevision) {
        throw new Error('The document changed during PDF preflight. Open preflight again.');
      }
      if (!textReady) throw new Error('Text sources changed or could not be prepared for PDF export.');
      opening.openDialog(createPdfExportPreflightSession({
        session: prepared.session, renderer: renderer!, fonts, fileName,
        isCurrent: () => isCurrent() && prepared.isCurrent(),
        prepareExport: async () => {
          prepared.assertCurrent();
          const next = await opening.fileIntents.prepareForUi();
          if (next.session !== session || next.renderer !== renderer) {
            throw new DOMException('The PDF export document was retired.', 'AbortError');
          }
          prepared.assertCurrent();
        }, deliver: opening.deliver
      }, services));
    } catch (error) {
      if (isCurrent() && !(error instanceof DOMException && error.name === 'AbortError')) {
        opening.reportError(error instanceof Error ? error.message : String(error));
      }
    }
  }, []);
};
