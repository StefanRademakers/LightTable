import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createAnchor, createSubpath, createVectorPath, type VectorPath } from '@lighttable/vector-core';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { createDocumentMutationController } from '../../application/documents/useDocumentMutationController';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createTextLayer } from '../../editor/document/documentCommands';
import type { TextToShapeConfirmation } from '../../application/text/TextToShapeIntent';
import { useTextToShape } from './useTextToShape';
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], setup: null as null | (() => () => void),
  dependencies: null as readonly unknown[] | null, changed: false }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (factory: () => unknown) => hooks.slots[hooks.cursor++] ??= factory(),
  useLayoutEffect: (setup: () => () => void, dependencies: readonly unknown[]) => {
    hooks.changed = !hooks.dependencies || dependencies.some((value, index) => value !== hooks.dependencies![index]);
    hooks.dependencies = [...dependencies]; hooks.setup = setup;
  }
}));
const sessions: DocumentSession[] = [];
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.setup = null; hooks.dependencies = null; hooks.changed = false; });
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
const deferred = <T,>() => { let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const glyph = createVectorPath('glyph', 'Glyph', [createSubpath('contour', [
  createAnchor('a', { x: 0, y: 0 }), createAnchor('b', { x: 10, y: 20 }), createAnchor('c', { x: 20, y: 0 })
], true)]);
const makeSession = () => {
  const session = new DocumentSession({ id: 'same-id' as DocumentSessionId,
    source: { id: 'source', name: 'Image', mediaType: 'image/png' } });
  session.setDocument(createTextLayer(createImageDocument('Text', 20, 20, 'pixels'), createDefaultTextLayerData(), 'Text'));
  session.setReady(); sessions.push(session); return session;
};
const fixture = () => {
  let session = makeSession(), runtime = {}, projected = session.getSnapshot().document;
  let renderer = { vectorPathsForTextLayer: vi.fn(async (): Promise<readonly VectorPath[]> => [glyph]) };
  let request: TextToShapeConfirmation | null = null;
  const history = vi.fn(), status = vi.fn(), error = vi.fn();
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => session.getSnapshot().document,
    applySnapshot: next => { session.setDocument(next); projected = next; },
    previewSnapshot: vi.fn(), discardPreview: vi.fn(), pushHistoryEntry: history
  }));
  const binding: Parameters<typeof useTextToShape>[0] = {
    lifecycle: runtime, generation: 1, getSession: () => session, getRenderer: () => renderer,
    getProjectedDocument: () => projected,
    captureScope: () => { const opening = runtime; return { isCurrent: () => runtime === opening }; },
    documentMutations: mutations, text: { finishBeforeTransition: vi.fn(() => true) },
    creation: { cancelPoint: vi.fn(), cancelParagraph: vi.fn() },
    dialogs: { requestTextToShape: next => { request = next; }, closeTextToShape: old => { if (request === old) request = null; } },
    execute: vi.fn(async () => ({ status: 'completed' })), status, error
  };
  const render = () => { hooks.cursor = 0; return useTextToShape(binding); };
  return { binding, render, history, status, error, session: () => session, renderer: () => renderer,
    request: () => request!, layerId: session.getSnapshot().document!.activeLayerId!,
    retire: (kind: 'session' | 'renderer' | 'runtime' | 'generation' | 'disposed' | 'mixed') => {
      if (kind === 'session') { session = makeSession(); projected = session.getSnapshot().document; }
      else if (kind === 'renderer') renderer = { vectorPathsForTextLayer: vi.fn(async () => [glyph]) };
      else if (kind === 'runtime') { runtime = {}; Object.assign(binding, { lifecycle: runtime }); }
      else if (kind === 'generation') { runtime = {}; Object.assign(binding, { generation: binding.generation + 1 }); }
      else if (kind === 'disposed') session.dispose();
      else projected = createImageDocument('Wrong', 20, 20, 'wrong');
    } };
};
describe('useTextToShape', () => {
  it('keeps pending glyph and confirmation authority through an ordinary chrome rerender', async () => {
    const f = fixture(), owners = f.render(), wait = deferred<readonly VectorPath[]>(); hooks.setup!();
    owners.intent.request(f.layerId); const request = f.request();
    f.renderer().vectorPathsForTextLayer.mockReturnValueOnce(wait.promise);
    const pending = owners.command.convert(f.layerId);
    expect(f.render()).toBe(owners); expect(hooks.changed).toBe(false);
    expect(f.request()).toBe(request); expect(request.isCurrent()).toBe(true);
    wait.resolve([glyph]); await expect(pending).resolves.toBe(true);
    expect(f.history).toHaveBeenCalledOnce();
    // The actual conversion changed the target, not the unrelated rerender.
    await request.confirm(); expect(f.binding.execute).not.toHaveBeenCalled();
    expect(f.error).toHaveBeenCalledWith(expect.stringContaining('text layer changed'));
  });
  it('binds confirmation execution to original session and confirm-time canonical revision', async () => {
    const f = fixture(), owners = f.render(); hooks.setup!(); owners.intent.request(f.layerId);
    await f.request().confirm(); expect(f.binding.execute).toHaveBeenCalledExactlyOnceWith(
      f.session().id, f.layerId, f.session().getSnapshot().documentRevision);
  });
  it.each(['session', 'renderer', 'runtime', 'generation', 'disposed', 'mixed'] as const)('rejects %s retirement before old confirmation dispatch', async kind => {
    const f = fixture(), owners = f.render(); hooks.setup!(); owners.intent.request(f.layerId); const request = f.request();
    f.retire(kind); await request.confirm(); expect(f.binding.execute).not.toHaveBeenCalled(); expect(f.error).not.toHaveBeenCalled();
  });
  it.each(['session', 'renderer', 'runtime', 'generation', 'disposed'] as const)('rejects deferred semantic glyph result after %s retirement', async kind => {
    const f = fixture(), owners = f.render(), wait = deferred<readonly VectorPath[]>(); hooks.setup!();
    f.renderer().vectorPathsForTextLayer.mockReturnValueOnce(wait.promise);
    const pending = owners.command.convert(f.layerId); f.retire(kind); wait.resolve([glyph]);
    await expect(pending).resolves.toBe(false); expect(f.history).not.toHaveBeenCalled();
  });
  it('layout replacement cancels old confirmation and cannot let old cleanup cancel successor work', async () => {
    const f = fixture(), owners = f.render(); let cleanup = hooks.setup!(); owners.intent.request(f.layerId);
    const old = f.request(), oldCleanup = cleanup; f.retire('renderer'); f.render(); expect(hooks.changed).toBe(true); cleanup();
    cleanup = hooks.setup!(); owners.intent.request(f.layerId); const next = f.request();
    oldCleanup(); await old.confirm(); old.cancel(); expect(f.request()).toBe(next); await next.confirm();
    expect(f.binding.execute).toHaveBeenCalledOnce(); cleanup();
  });
  it('StrictMode replay cancels old glyph work and retained unmounted UI callbacks stay quiet', async () => {
    const f = fixture(), owners = f.render(), wait = deferred<readonly VectorPath[]>(); const cleanup = hooks.setup!();
    f.renderer().vectorPathsForTextLayer.mockReturnValueOnce(wait.promise);
    const pending = owners.command.convert(f.layerId); cleanup(); owners.intent.request(f.layerId);
    expect(f.error).not.toHaveBeenCalled(); hooks.setup!(); wait.resolve([glyph]);
    await expect(pending).resolves.toBe(false); expect(f.history).not.toHaveBeenCalled();
    await expect(owners.command.convert(f.layerId)).resolves.toBe(true); expect(f.history).toHaveBeenCalledOnce();
  });
});
