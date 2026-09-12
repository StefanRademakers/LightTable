import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPositionedTextFixture } from '@lighttable/text-core';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { createDocumentMutationController } from '../../application/documents/useDocumentMutationController';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createTextLayer } from '../../editor/document/documentCommands';
import { usePositionedTextRecovery } from './usePositionedTextRecovery';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], setup: null as null | (() => () => void) }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (create: () => unknown, dependencies: readonly unknown[]) => {
    const index = hooks.cursor++, previous = hooks.slots[index] as { value: unknown; dependencies: readonly unknown[] } | undefined;
    if (previous && dependencies.every((item, i) => item === previous.dependencies[i])) return previous.value;
    const entry = { value: create(), dependencies }; hooks.slots[index] = entry; return entry.value;
  },
  useLayoutEffect: (setup: () => () => void) => { hooks.setup = setup; }
}));
const sessions: DocumentSession[] = [];
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.setup = null; });
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
const makeSession = () => {
  const session = new DocumentSession({ id: 'same-id' as DocumentSessionId, source: { id: 'A', name: 'A', mediaType: 'image/png' } });
  const text = createPositionedTextFixture();
  if (text.source.kind !== 'positioned') throw new Error('Expected positioned fixture.');
  session.setDocument(createTextLayer(createImageDocument('Recovery', 100, 50, 'asset'),
    { ...text, source: { ...text.source, editability: 'recoverable' } }, 'Imported'));
  session.setReady(); sessions.push(session); return session;
};
const fixture = () => {
  let session = makeSession(), renderer: object | null = {}, lifecycle = {}, projected = session.getSnapshot().document;
  const history = vi.fn();
  const mutations = createDocumentMutationController(() => ({ getDocument: () => session.getSnapshot().document,
    applySnapshot: document => { session.setDocument(document); projected = document; },
    previewSnapshot: vi.fn(), discardPreview: vi.fn(), pushHistoryEntry: history }));
  const binding: Parameters<typeof usePositionedTextRecovery>[0] = {
    open: true, lifecycle, generation: 1, getSession: () => session, getRenderer: () => renderer, getProjectedDocument: () => projected,
    captureScope: () => { const opening = lifecycle; return { isCurrent: () => lifecycle === opening }; },
    documentMutations: mutations, text: { finishBeforeTransition: vi.fn(() => true) }, status: vi.fn(), error: vi.fn()
  };
  const render = () => { hooks.cursor = 0; return usePositionedTextRecovery(binding); };
  return { binding, history, render, session: () => session,
    retire: (kind: 'session' | 'renderer' | 'lifecycle' | 'generation' | 'disposed' | 'mixed' | 'null') => {
      if (kind === 'session') { session = makeSession(); projected = session.getSnapshot().document; }
      if (kind === 'renderer') renderer = {};
      if (kind === 'lifecycle') { lifecycle = {}; Object.assign(binding, { lifecycle }); }
      if (kind === 'generation') Object.assign(binding, { generation: binding.generation + 1 });
      if (kind === 'disposed') session.dispose();
      if (kind === 'mixed') projected = createImageDocument('Wrong', 100, 50, 'wrong');
      if (kind === 'null') renderer = null;
    } };
};
it('ordinary rerender keeps offered source usable; unmounted callback cannot mutate', () => {
  const f = fixture(), owner = f.render(), offer = owner.offer(f.session().getSnapshot().document!.activeLayerId)!;
  expect(offer.onRecover()).toBe(false); expect(f.history).not.toHaveBeenCalled();
  const cleanup = hooks.setup!(); expect(f.render()).toBe(owner);
  expect(offer.onRecover()).toBe(true); expect(f.history).toHaveBeenCalledOnce();
  cleanup(); expect(offer.onRecover()).toBe(false); expect(f.binding.error).not.toHaveBeenCalled();
});
it.each(['session', 'renderer', 'lifecycle', 'generation', 'disposed', 'mixed', 'null'] as const)('rejects retained offer after %s replacement before layout cleanup', kind => {
  const f = fixture(), owner = f.render(); hooks.setup!();
  const offer = owner.offer(f.session().getSnapshot().document!.activeLayerId)!;
  f.retire(kind); f.render();
  expect(offer.onRecover()).toBe(false); expect(f.history).not.toHaveBeenCalled();
  expect(f.binding.text.finishBeforeTransition).not.toHaveBeenCalled();
  expect(f.binding.error).not.toHaveBeenCalled(); expect(f.binding.status).not.toHaveBeenCalled();
});
it('StrictMode reconnect can recover without a stale cleanup closing a replacement owner', () => {
  const f = fixture(), first = f.render(), cleanup = hooks.setup!(); cleanup(); hooks.setup!();
  expect(first.offer(f.session().getSnapshot().document!.activeLayerId)!.analysis.status).toBe('available');
  f.retire('renderer'); const second = f.render(); hooks.setup!(); cleanup();
  expect(second.offer(f.session().getSnapshot().document!.activeLayerId)!.onRecover()).toBe(true);
  expect(f.history).toHaveBeenCalledOnce();
});
it('committed close/reopen retires the offered source even with the same session and renderer', () => {
  const f = fixture(), first = f.render(), cleanup = hooks.setup!();
  const offer = first.offer(f.session().getSnapshot().document!.activeLayerId)!;
  Object.assign(f.binding, { open: false }); const closed = f.render();
  expect(offer.onRecover()).toBe(false); // Closed render cannot start mutation before layout cleanup either.
  cleanup(); const closeCleanup = hooks.setup!();
  expect(closed.offer(f.session().getSnapshot().document!.activeLayerId)!.onRecover()).toBe(false);
  Object.assign(f.binding, { open: true }); const reopened = f.render(); closeCleanup(); hooks.setup!();
  expect(offer.onRecover()).toBe(false); expect(f.history).not.toHaveBeenCalled();
  expect(f.binding.text.finishBeforeTransition).not.toHaveBeenCalled();
  expect(reopened.offer(f.session().getSnapshot().document!.activeLayerId)!.onRecover()).toBe(true);
  expect(f.history).toHaveBeenCalledOnce(); expect(f.binding.error).not.toHaveBeenCalled();
});
