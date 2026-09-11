import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { DocumentSession, type DocumentSessionId } from '../documents/documentSession';
import { DocumentSurfaceHistoryBinding, type DocumentSurfaceHistoryRenderer } from './DocumentSurfaceHistoryBinding';

const setup = () => {
  const session = new DocumentSession({ id: 'surface-history' as DocumentSessionId,
    source: { id: 'source', name: 'surface.png', mediaType: 'image/png' } });
  session.setDocument(createImageDocument('Surface', 12, 10, 'surface'));
  session.setReady();
  let current = true;
  let generation = 1;
  let renderer: DocumentSurfaceHistoryRenderer = {
    publishDocumentSurfaceHistory: vi.fn(async (_owner, publish) => publish(vi.fn())),
  };
  const owner = new DocumentSurfaceHistoryBinding(session, {
    isSessionCurrent: () => current, getRenderer: () => renderer, getGeneration: () => generation,
  });
  const resourceOwner = {};
  const publish = vi.fn();
  session.history.record({ id: 'resize', documentId: session.id, type: 'document.image-size',
    label: 'Image Size', affectsDocument: true, byteSize: 1,
    undo: () => owner.publish(resourceOwner, publish), redo: () => owner.publish(resourceOwner, publish) });
  return { session, owner, publish, resourceOwner, initialRenderer: renderer,
    retire: () => { current = false; }, replaceGeneration: () => { generation++; },
    replaceRenderer: (next: DocumentSurfaceHistoryRenderer) => { renderer = next; } };
};

describe('DocumentSurfaceHistoryBinding', () => {
  it('uses the current same-session renderer after replacement, inside real history replay admission', async () => {
    const state = setup();
    const next: DocumentSurfaceHistoryRenderer = { publishDocumentSurfaceHistory: vi.fn(async (_resource, publish) => publish(vi.fn())) };
    state.replaceRenderer(next);
    state.replaceGeneration();
    await expect(state.session.history.undo()).resolves.toBe(true);
    expect(state.initialRenderer.publishDocumentSurfaceHistory).not.toHaveBeenCalled();
    expect(next.publishDocumentSurfaceHistory).toHaveBeenCalledWith(state.resourceOwner, expect.any(Function), expect.any(Function));
    expect(state.publish).toHaveBeenCalledOnce();
    await expect(state.session.history.redo()).resolves.toBe(true);
    expect(state.session.isAcceptingMutations()).toBe(true);
  });

  it('blocks foreign writes while queued and rejects renderer retirement without publishing', async () => {
    const state = setup();
    vi.mocked(state.initialRenderer.publishDocumentSurfaceHistory).mockImplementation(async (_resource, publish) => {
      expect(() => state.session.setDocument(null)).toThrow('surface history');
      expect(state.session.isAcceptingMutations()).toBe(false);
      await Promise.resolve();
      state.replaceGeneration();
      publish(vi.fn());
    });
    await expect(state.session.history.undo()).rejects.toThrow('binding changed');
    expect(state.publish).not.toHaveBeenCalled();
    expect(state.session.history.getSnapshot().undoDepth).toBe(1);
    expect(state.session.isAcceptingMutations()).toBe(true);
  });

  it('does not allow ordinary callers to claim replay admission', async () => {
    const state = setup();
    await expect(state.owner.publish(state.resourceOwner, state.publish)).rejects.toThrow('active undo or redo');
    expect(state.session.isAcceptingMutations()).toBe(true);
    state.retire();
    await expect(state.session.history.undo()).rejects.toThrow('current document renderer');
  });
});
