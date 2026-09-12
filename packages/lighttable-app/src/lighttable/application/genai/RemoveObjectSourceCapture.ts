import type { RemoveObjectSource } from '../../../genai/application/removeObjectCommand';
import type { DocumentSession } from '../documents/documentSession';
import type { DocumentFileIntents } from '../documents/DocumentFileIntents';
import { DocumentSelectionStateStore } from '../tools/selection/DocumentSelectionStateStore';
import type { ImageDocument } from '../../editor/document/documentTypes';

export interface RemoveObjectSourceRenderer {
  synchronizeDocumentForExport(document: ImageDocument): Promise<void> | void;
  exportRgba8(options: { onReadbackSubmitted(): void }): Promise<{
    pixels: Uint8ClampedArray; width: number; height: number;
  }>;
}

export interface RemoveObjectSourcePorts {
  readonly session: DocumentSession;
  readonly renderer: RemoveObjectSourceRenderer;
  readonly projectId: string;
  readonly documentName: string;
  readonly fileIntents: Pick<DocumentFileIntents, 'prepareForUi'>;
  assertCurrent(): void;
  hasActiveMutation(): boolean;
  projectProcessing(): void;
  maskToRgba8(raw: Uint16Array): Uint8ClampedArray;
  encodePng(pixels: Uint8ClampedArray, width: number, height: number): Promise<Blob>;
}

/** Captures editor inputs only; provider discovery, imports and jobs stay in GenAI. */
export const captureRemoveObjectSource = async (ports: RemoveObjectSourcePorts): Promise<RemoveObjectSource> => {
  ports.assertCurrent();
  const prepared = await ports.fileIntents.prepareForUi();
  ports.assertCurrent(); prepared.assertCurrent();
  const { session, renderer } = ports;
  if (prepared.session !== session || prepared.renderer !== renderer) {
    throw new Error('Remove Object preparation returned a different document renderer.');
  }
  // No await between checking active owners and reserving the existing admission.
  if (ports.hasActiveMutation()) throw new Error('Finish the current edit before using Remove Object.');
  const admission = session.acquireMutationAdmission('Capturing Remove Object source pixels.');
  let released = false;
  const release = () => { if (!released) { released = true; admission.release(); } };
  try {
    const opening = session.getSnapshot();
    const document = opening.document;
    if (!document) throw new Error('Remove Object requires a ready document.');
    const selection = new DocumentSelectionStateStore(session).acquire(opening.documentRevision).selection;
    if (!selection.active || !selection.supportBounds
      || selection.coverage.width !== document.width || selection.coverage.height !== document.height) {
      throw new Error('Select a non-empty area before using Remove Object.');
    }
    const assertCurrent = () => {
      ports.assertCurrent(); prepared.assertCurrent();
      const current = session.getSnapshot();
      if (current.documentRevision !== opening.documentRevision || current.document !== document
        || current.editor.selectionRevision !== selection.revision
        || current.editor.selectionMaskSnapshot !== selection.coverage) {
        throw new Error('The Remove Object source changed. Submit again from the intended selection.');
      }
    };
    assertCurrent();
    ports.projectProcessing();
    await renderer.synchronizeDocumentForExport(document);
    assertCurrent();
    const pixels = await renderer.exportRgba8({ onReadbackSubmitted: release });
    if (!released) throw new Error('Remove Object readback did not publish its submission boundary.');
    assertCurrent();
    if (pixels.width !== document.width || pixels.height !== document.height) {
      throw new Error('Remove Object pixels do not match the captured document dimensions.');
    }
    // Coverage is immutable. CPU conversion must not extend mutation admission.
    const mask = ports.maskToRgba8(selection.coverage.toRaw());
    const [baseBlob, selectionBlob] = await Promise.all([
      ports.encodePng(pixels.pixels, document.width, document.height),
      ports.encodePng(mask, document.width, document.height)
    ]);
    assertCurrent();
    return { baseBlob, selectionBlob, documentName: ports.documentName,
      width: document.width, height: document.height, assertCurrent,
      editorDelivery: { projectId: ports.projectId, documentId: String(session.id),
        sourceRevision: opening.documentRevision, behavior: 'place-edit' } };
  } finally { release(); }
};
