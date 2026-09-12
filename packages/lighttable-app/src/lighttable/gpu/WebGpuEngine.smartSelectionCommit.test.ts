import { expect, it, vi } from 'vitest';
import type { DocumentAddress, SelectionRevision } from '@lighttable/editor-kernel';
import { DocumentSession, type DocumentSessionId } from '../application/documents/documentSession';
import { SelectionShapeCommandService, type SelectionProjectionCommandPort } from '../application/tools/selection/SelectionShapeCommandService';
import { createImageDocument } from '../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../editor/selection/SelectionMaskSnapshot';
import { createObjectSelectionOperation } from '../editor/selection/selectionTypes';
import { WebGpuEngine } from './WebGpuEngine';

it('commits Object Selection through the real GPU boundary with distinct content and session clocks', async () => {
  const session = new DocumentSession({ id: 'document-1' as DocumentSessionId,
    source: { id: 'source', name: 'image.png', mediaType: 'image/png' } });
  session.setDocument(createImageDocument('image.png', 10, 8, 'source'));
  session.setReady();
  const document = session.getSnapshot().document!;
  session.markChanged();
  const canonicalRevision = session.getSnapshot().documentRevision;
  expect(canonicalRevision).toBeGreaterThan(document.revision);
  const coverage = SelectionMaskSnapshot.fromRaw(10, 8, new Uint16Array(80).fill(0x3c00));
  const events: string[] = [];
  const prepare = vi.fn<SelectionProjectionCommandPort['prepareSelectionShapeProjection']>(
    async (_address, baseline, intent, id) => ({
      transactionId: id, baselineRevision: baseline.revision,
      result: { ...baseline, revision: (baseline.revision + 1) as SelectionRevision,
        active: true, coverage, supportBounds: { x: 0, y: 0, width: 10, height: 8 },
        provenance: [intent.provenance] },
      activate: () => { events.push('activate'); return {
        accept: () => { events.push('accept'); }, rollback: () => { events.push('rollback'); }
      }; },
      dispose: () => { events.push('dispose'); }
    })
  );
  const renderer = { prepareSelectionShapeProjection: prepare };
  const engine = Object.assign(Object.create(WebGpuEngine.prototype), {
    imageDocument: document, documentRenderer: renderer, selectionQueue: Promise.resolve(),
    destroyed: false, renderDirty: { invalidate: vi.fn() }, requestRender: vi.fn()
  }) as WebGpuEngine;
  const port = {
    prepareSelectionShapeProjection: engine.prepareSelectionShapeProjection.bind(engine),
    setCommittedSelectionProjection: () => { events.push('overlay:1'); }
  } as unknown as SelectionProjectionCommandPort;
  const service = new SelectionShapeCommandService(session, () => port);
  const intent = { mask: { width: document.width, height: document.height,
    data: new Uint8Array(document.width * document.height).fill(255) }, mode: 'replace' as const,
    provenance: createObjectSelectionOperation(document.revision, document.width, document.height, 'replace') };

  await expect(service.executeRasterMask(intent)).resolves.toBe(true);
  expect(prepare).toHaveBeenCalledWith(
    expect.objectContaining({ revision: canonicalRevision }), expect.anything(), intent,
    expect.anything(), expect.any(AbortSignal));
  expect(session.getSnapshot().editor.selectionMaskSnapshot).toBe(coverage);
  expect(session.history.getSnapshot().undoDepth).toBe(1);
  expect(events).toEqual(['activate', 'overlay:1', 'accept']);

  const baseline = session.getSnapshot().editor;
  const address = { sessionId: session.id, revision: session.getSnapshot().documentRevision };
  const parameters = prepare.mock.calls[0]!;
  await expect(engine.prepareSelectionShapeProjection(
    address as unknown as DocumentAddress, parameters[1],
    { ...intent, provenance: createObjectSelectionOperation(document.revision + 1, document.width, document.height, 'replace') },
    parameters[3], new AbortController().signal
  )).rejects.toThrow('The Object Selection result is no longer current.');
  expect(session.getSnapshot().editor).toBe(baseline);
  expect(session.history.getSnapshot().undoDepth).toBe(1);
  expect(prepare).toHaveBeenCalledOnce();
  session.dispose();
});
