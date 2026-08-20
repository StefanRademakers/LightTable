import { describe, expect, it, vi } from 'vitest';
import type { DocumentSessionId } from '../documents/documentSession';
import { LightTableArtifactRegistry } from './lightTableArtifactRegistry';
import {
  DocumentPreviewArtifactController,
  MAX_AGENT_PREVIEW_EDGE
} from './documentPreviewArtifacts';

const documentId = 'document-1' as DocumentSessionId;

const setup = () => {
  const registry = new LightTableArtifactRegistry({ maximumArtifacts: 2 });
  let document = { lifecycle: 'ready', canonicalRevision: 7, width: 1600, height: 900 };
  const render = vi.fn(async (_id: DocumentSessionId, edge: number) =>
    new File(['preview'], `preview-${edge}.png`, { type: 'image/png' }));
  const controller = new DocumentPreviewArtifactController({
    snapshot: () => document,
    render,
    register: (file, context) => registry.registerPreview(file, context),
    query: (id) => registry.query(id)
  });
  return { controller, registry, render,
    setDocument: (next: typeof document) => { document = next; } };
};

describe('DocumentPreviewArtifactController', () => {
  it('creates and reuses a bounded artifact tied to an exact canonical revision', async () => {
    const state = setup();
    const first = await state.controller.request({
      documentId, expectedDocumentRevision: 7, maxEdge: 800
    });
    expect(first).toMatchObject({ status: 'completed', reused: false,
      artifact: { kind: 'render-preview', preview: {
        documentId, canonicalRevision: 7, width: 800, height: 450, maxEdge: 800
      } } });
    const second = await state.controller.request({
      documentId, expectedDocumentRevision: 7, maxEdge: 800
    });
    expect(second).toMatchObject({ status: 'completed', reused: true });
    expect(state.render).toHaveBeenCalledOnce();
  });

  it('binds a document-space region, output dimensions and encoding into artifact identity', async () => {
    const state = setup();
    const request = { documentId, expectedDocumentRevision: 7, maxEdge: 400,
      region: { x: 200, y: 100, width: 800, height: 400 }, format: 'webp', quality: 0.6 };
    const first = await state.controller.request(request);
    expect(first).toMatchObject({ status: 'completed', reused: false,
      artifact: { preview: { width: 400, height: 200, format: 'webp', quality: 0.6,
        target: { kind: 'region', coordinateSpace: 'document-px', bounds: request.region } } } });
    expect(state.render).toHaveBeenCalledWith(documentId, 400,
      { format: 'webp', quality: 0.6 }, request.region);
    await state.controller.request({ ...request, region: { ...request.region, x: 201 } });
    expect(state.render).toHaveBeenCalledTimes(2);
  });

  it('rejects stale, malformed and oversized requests before rendering', async () => {
    const state = setup();
    await expect(state.controller.request({ documentId, expectedDocumentRevision: 6 }))
      .resolves.toMatchObject({ status: 'rejected', code: 'stale-document-revision',
        currentRevision: 7 });
    for (const request of [
      { documentId },
      { documentId, expectedDocumentRevision: 7, maxEdge: 63 },
      { documentId, expectedDocumentRevision: 7, maxEdge: MAX_AGENT_PREVIEW_EDGE + 1 },
      { documentId, expectedDocumentRevision: 7,
        region: { x: 1500, y: 0, width: 200, height: 100 } }
    ]) {
      await expect(state.controller.request(request)).resolves.toMatchObject({
        status: 'rejected', code: 'invalid-request'
      });
    }
    expect(state.render).not.toHaveBeenCalled();
  });

  it('fails closed when the document changes during GPU readback', async () => {
    const state = setup();
    let resolve!: (file: File) => void;
    state.render.mockImplementationOnce(() => new Promise<File>((done) => { resolve = done; }));
    const pending = state.controller.request({
      documentId, expectedDocumentRevision: 7, maxEdge: 512
    });
    state.setDocument({ lifecycle: 'ready', canonicalRevision: 8, width: 1600, height: 900 });
    resolve(new File(['stale'], 'stale.png', { type: 'image/png' }));
    await expect(pending).resolves.toMatchObject({
      status: 'rejected', code: 'stale-document-revision', currentRevision: 8
    });
    expect(state.registry.list()).toHaveLength(0);
  });

  it('coalesces concurrent requests and regenerates a released artifact', async () => {
    const state = setup();
    const request = { documentId, expectedDocumentRevision: 7, maxEdge: 512 };
    const [first, concurrent] = await Promise.all([
      state.controller.request(request), state.controller.request(request)
    ]);
    expect(first).toEqual(concurrent);
    expect(state.render).toHaveBeenCalledOnce();
    if (first.status !== 'completed') throw new Error('Expected a completed preview.');
    state.registry.release(first.artifact.id);
    state.controller.invalidateArtifact(first.artifact.id);
    await expect(state.controller.request(request)).resolves.toMatchObject({
      status: 'completed', reused: false
    });
    expect(state.render).toHaveBeenCalledTimes(2);
  });

  it('reports renderer failures without registering an artifact', async () => {
    const state = setup();
    state.render.mockRejectedValueOnce(new Error('GPU unavailable'));
    await expect(state.controller.request({
      documentId, expectedDocumentRevision: 7, maxEdge: 512
    })).resolves.toMatchObject({ status: 'rejected', code: 'renderer-unavailable',
      message: 'GPU unavailable' });
    expect(state.registry.list()).toHaveLength(0);
  });

  it('does not publish a late renderer result after its owner is cleared', async () => {
    const state = setup();
    let resolve!: (file: File) => void;
    state.render.mockImplementationOnce(() => new Promise<File>((done) => { resolve = done; }));
    const pending = state.controller.request({
      documentId, expectedDocumentRevision: 7, maxEdge: 512
    });
    state.controller.clear();
    resolve(new File(['late'], 'late.png', { type: 'image/png' }));
    await expect(pending).resolves.toMatchObject({
      status: 'rejected', code: 'document-not-ready'
    });
    expect(state.registry.list()).toHaveLength(0);
  });
});
