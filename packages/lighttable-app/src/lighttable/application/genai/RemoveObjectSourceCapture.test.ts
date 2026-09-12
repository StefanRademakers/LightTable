import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureRemoveObjectSource, type RemoveObjectSourcePorts } from './RemoveObjectSourceCapture';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';
import { halfFloatSelectionMaskToRgba8 } from '../../gpu/gpuReadback';

const sessions: DocumentSession[] = [];
afterEach(() => sessions.splice(0).forEach(session => session.dispose()));
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const fixture = () => {
  const session = new DocumentSession({ id: 'source' as DocumentSessionId,
    source: { id: 'image', name: 'image.png', mediaType: 'image/png' } });
  sessions.push(session);
  session.setDocument(createImageDocument('image', 2, 2, 'asset')); session.setReady();
  const raw = new Uint16Array([0, 0x3800, 0x3c00, 0x3400]);
  const coverage = SelectionMaskSnapshot.fromRaw(2, 2, raw);
  session.updateEditor(editor => ({ ...editor, selectionRevision: 1, selectionMaskSnapshot: coverage,
    selectionSupportBounds: { x: 0, y: 0, width: 2, height: 2 }, selection: [] }));
  const events: string[] = [];
  const pixels = new Uint8ClampedArray(16).fill(123);
  let current = true;
  const assertCurrent = () => { if (!current) throw new Error('retired'); };
  const renderer = {
    synchronizeDocumentForExport: vi.fn(async () => {
      expect(session.isAcceptingMutations()).toBe(false); events.push('sync');
    }),
    exportRgba8: vi.fn(async ({ onReadbackSubmitted }: { onReadbackSubmitted(): void }) => {
      expect(session.isAcceptingMutations()).toBe(false); events.push('submit');
      onReadbackSubmitted();
      expect(session.isAcceptingMutations()).toBe(true); events.push('map');
      return { pixels, width: 2, height: 2 };
    })
  };
  const ports: RemoveObjectSourcePorts = { session, renderer, projectId: 'project-A', documentName: 'source.png',
    fileIntents: { prepareForUi: vi.fn(async () => {
      expect(session.isAcceptingMutations()).toBe(true); events.push('prepare');
      return { session, renderer, assertCurrent, isCurrent: () => current };
    }) }, assertCurrent, hasActiveMutation: vi.fn(() => false),
    projectProcessing: vi.fn(() => { expect(session.isAcceptingMutations()).toBe(false); events.push('processing'); }),
    maskToRgba8: vi.fn(raw => {
      expect(session.isAcceptingMutations()).toBe(true);
      return halfFloatSelectionMaskToRgba8(raw);
    }),
    encodePng: vi.fn(async data => {
      expect(session.isAcceptingMutations()).toBe(true); events.push('encode');
      return new Blob([new Uint8Array(data)]);
    }) };
  return { session, renderer, ports, raw, pixels, events, retire: () => { current = false; } };
};

describe('Remove Object committed editor source capture', () => {
  it('uses canonical feathered paint-only coverage, one base readback and a short admission', async () => {
    const f = fixture(), revision = f.session.getSnapshot().documentRevision;
    const source = await captureRemoveObjectSource(f.ports);
    expect(f.events).toEqual(['prepare', 'processing', 'sync', 'submit', 'map', 'encode', 'encode']);
    expect(new Uint8Array(await source.selectionBlob.arrayBuffer())).toEqual(new Uint8Array(halfFloatSelectionMaskToRgba8(f.raw)));
    expect(new Uint8Array(await source.baseBlob.arrayBuffer())).toEqual(new Uint8Array(f.pixels));
    expect(f.renderer.exportRgba8).toHaveBeenCalledOnce();
    expect(source.editorDelivery).toEqual({ projectId: 'project-A', documentId: 'source', sourceRevision: revision, behavior: 'place-edit' });
    expect(f.session.getSnapshot().documentRevision).toBe(revision);
    expect(f.session.history.getSnapshot().undoDepth).toBe(0);
  });
  it('rejects a new active gesture after preparation without acquiring a readback', async () => {
    const f = fixture(); f.ports.hasActiveMutation = () => true;
    await expect(captureRemoveObjectSource(f.ports)).rejects.toThrow('Finish the current edit');
    expect(f.session.isAcceptingMutations()).toBe(true);
    expect(f.renderer.exportRgba8).not.toHaveBeenCalled();
  });
  it('blocks mutations throughout deferred final-source synchronization', async () => {
    const f = fixture(), ready = deferred<void>();
    f.renderer.synchronizeDocumentForExport.mockImplementation(() => ready.promise);
    const capture = captureRemoveObjectSource(f.ports);
    await Promise.resolve();
    expect(f.session.isAcceptingMutations()).toBe(false);
    ready.resolve(); await capture;
    expect(f.session.isAcceptingMutations()).toBe(true);
  });
  it.each(['sync', 'readback', 'missing-submission', 'dimensions', 'encoding'] as const)('releases admission on %s failure', stage => {
    const f = fixture();
    if (stage === 'sync') f.renderer.synchronizeDocumentForExport.mockRejectedValue(new Error('sync'));
    if (stage === 'readback') f.renderer.exportRgba8.mockRejectedValue(new Error('readback'));
    if (stage === 'missing-submission') f.renderer.exportRgba8.mockResolvedValue({ pixels: f.pixels, width: 2, height: 2 });
    if (stage === 'dimensions') f.renderer.exportRgba8.mockImplementation(async options => {
      options.onReadbackSubmitted(); return { pixels: f.pixels, width: 9, height: 9 };
    });
    if (stage === 'encoding') f.ports.encodePng = async () => { throw new Error('encoding'); };
    return expect(captureRemoveObjectSource(f.ports)).rejects.toThrow().then(() => {
      expect(f.session.isAcceptingMutations()).toBe(true);
      expect(f.session.history.getSnapshot().undoDepth).toBe(0);
    });
  });
  it('allows editing during delayed encoding but rejects changed source before submission', async () => {
    const f = fixture(), encoded = deferred<Blob>();
    f.ports.encodePng = () => encoded.promise;
    const capture = captureRemoveObjectSource(f.ports);
    await vi.waitFor(() => expect(f.renderer.exportRgba8).toHaveBeenCalledOnce());
    expect(f.session.isAcceptingMutations()).toBe(true);
    f.session.publishProcessing({ adjustments: { ...f.session.getSnapshot().processing.adjustments, exposureEV: 1 } });
    encoded.resolve(new Blob());
    await expect(capture).rejects.toThrow('source changed');
  });
  it('rejects retirement while synchronization is pending and releases the original admission', async () => {
    const f = fixture(), ready = deferred<void>();
    f.renderer.synchronizeDocumentForExport.mockImplementation(() => ready.promise);
    const capture = captureRemoveObjectSource(f.ports);
    await Promise.resolve(); f.retire(); ready.resolve();
    await expect(capture).rejects.toThrow('retired');
    expect(f.session.isAcceptingMutations()).toBe(true);
    expect(f.renderer.exportRgba8).not.toHaveBeenCalled();
  });
  it('rejects inactive coverage without reading GPU pixels', async () => {
    const f = fixture();
    f.session.updateEditor(editor => ({ ...editor, selectionMaskSnapshot: SelectionMaskSnapshot.inactive(2, 2) }));
    await expect(captureRemoveObjectSource(f.ports)).rejects.toThrow('non-empty');
    expect(f.renderer.exportRgba8).not.toHaveBeenCalled();
    expect(f.session.isAcceptingMutations()).toBe(true);
  });
});
