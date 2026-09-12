import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type ImageDocument } from '../../editor/document/documentTypes';
import { createDocumentMutationController, type DocumentMutationHistoryEntry } from '../documents/useDocumentMutationController';
import { captureInteractionScope } from '../interactions/captureInteractionScope';
import { LayerDocumentInteractionOwner, type LayerDocumentInteractionBinding } from './LayerDocumentInteractionOwner';

const setup = () => {
  let document = createImageDocument('Opening', 32, 24, 'one');
  let preview: ImageDocument | null = null;
  let lifecycle = {};
  let blocked = false;
  const renderer = {};
  const history: DocumentMutationHistoryEntry[] = [];
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => document,
    applySnapshot: next => { document = next; },
    previewSnapshot: next => { preview = next; },
    discardPreview: () => { preview = null; },
    pushHistoryEntry: entry => { history.push(entry); },
    isMutationBlocked: () => blocked
  }));
  const resetFaceWarp = vi.fn();
  const cancelTextProperties = vi.fn();
  const commitTextProperties = vi.fn<() => boolean | null>(() => null);
  const capture = (): LayerDocumentInteractionBinding => ({
    mutations, resetFaceWarp, cancelTextProperties, commitTextProperties,
    assertCurrent: captureInteractionScope({
      getWorkspaceId: () => document.id,
      getRenderer: () => renderer,
      getRendererGeneration: () => 1,
      getLifecycleIdentity: () => lifecycle
    }).assertCurrent
  });
  let bindingProvider = capture;
  const owner = new LayerDocumentInteractionOwner(() => bindingProvider());
  return {
    owner, mutations, history, resetFaceWarp, cancelTextProperties, commitTextProperties,
    get document() { return document; }, get preview() { return preview; },
    replaceLifecycle: () => { lifecycle = {}; },
    block: () => { blocked = true; },
    replaceCanonical: () => { document = { ...document, name: 'Externally changed', revision: document.revision + 1 }; },
    rebindProvider: () => { bindingProvider = () => capture(); }
  };
};

describe('layer document interaction ownership', () => {
  it('file preparation commits one exact document gesture without resetting domains', async () => {
    const state = setup(); state.owner.begin(); state.owner.change(document => ({ ...document, name: 'File content' }));
    await state.owner.finishForFile(); expect(state.document.name).toBe('File content');
    expect(state.history).toHaveLength(1); expect(state.mutations.active).toBe(false);
    expect(state.resetFaceWarp).not.toHaveBeenCalled(); expect(state.cancelTextProperties).not.toHaveBeenCalled();
  });
  it('file preparation waits for the original async document publication', async () => {
    const state = setup(); let resolve!: () => void;
    const waiting = new Promise<void>(yes => { resolve = yes; });
    const transaction = state.mutations.begin('pending')!;
    transaction.change(document => ({ ...document, name: 'Pending publication' }));
    const committing = transaction.commitWithAsync(async () => { await waiting; return true; });
    const file = state.owner.finishForFile(); expect(state.commitTextProperties).not.toHaveBeenCalled();
    resolve(); await committing; await file; expect(state.commitTextProperties).not.toHaveBeenCalled();
  });
  it('file preparation rejects retirement during publication without committing successor properties', async () => {
    const state = setup(); state.owner.begin(); const file = state.owner.finishForFile(); state.replaceLifecycle();
    await expect(file).rejects.toThrow('retired document renderer');
    expect(state.commitTextProperties).not.toHaveBeenCalled();
  });
  it('an initially idle file terminal never commits a successor gesture admitted in the next microtask', async () => {
    const state = setup(); const file = state.owner.finishForFile();
    state.owner.begin(); state.owner.change(document => ({ ...document, name: 'New gesture' }));
    await file; expect(state.history).toHaveLength(0); expect(state.mutations.active).toBe(true);
    expect(state.commitTextProperties).not.toHaveBeenCalled();
  });
  it('file preparation rejects an unfinished text-owned terminal without generic fallback commit', async () => {
    const state = setup(); state.owner.begin(); state.owner.change(document => ({ ...document, name: 'Pending' }));
    state.commitTextProperties.mockReturnValue(false);
    await expect(state.owner.finishForFile()).rejects.toThrow('gesture did not finish');
    expect(state.history).toHaveLength(0); expect(state.mutations.active).toBe(true);
  });
  it.each(['block', 'replaceCanonical'] as const)('file preparation rejects %s cancellation of changed pixels', async action => {
    const state = setup(); state.owner.begin(); state.owner.change(document => ({ ...document, name: 'Unsaved preview' }));
    state[action]();
    await expect(state.owner.finishForFile()).rejects.toThrow('document gesture');
    expect(state.history).toHaveLength(0); expect(state.document.name).not.toBe('Unsaved preview');
  });
  it('file preparation accepts a legitimate unchanged document gesture', async () => {
    const state = setup(); state.owner.begin();
    await expect(state.owner.finishForFile()).resolves.toBeUndefined(); expect(state.history).toHaveLength(0);
  });
  it.each(['false', 'throw'] as const)('file preparation rejects async publisher %s instead of treating idle as success', async outcome => {
    const state = setup(); let resolve!: () => void; const wait = new Promise<void>(yes => { resolve = yes; });
    const transaction = state.mutations.begin('compound')!;
    transaction.change(document => ({ ...document, name: 'Pending' }));
    const commit = transaction.commitWithAsync(async () => { await wait;
      if (outcome === 'throw') throw new Error('GPU publication failed'); return false; });
    const observedCommit = commit.catch(() => false);
    const file = expect(state.owner.finishForFile()).rejects.toThrow('failed');
    resolve(); await observedCommit; await file; expect(state.history).toHaveLength(0);
  });
  it('retains a gesture across provider replacement and commits one exact undo/redo entry', () => {
    const state = setup();
    const opening = state.document;
    expect(state.owner.begin()).toBe(true);
    state.owner.change(document => ({ ...document, name: 'Preview 1' }));
    state.rebindProvider();
    expect(state.owner.begin()).toBe(false);
    state.owner.change(document => ({ ...document, name: 'Final' }));
    expect(state.history).toHaveLength(0);
    expect(state.owner.commit()).toBe(true);
    const final = state.document;
    expect(final.name).toBe('Final');
    expect(state.history).toHaveLength(1);
    state.history[0].undo();
    expect(state.document).toBe(opening);
    state.history[0].redo();
    expect(state.document).toBe(final);
    expect(state.owner.commit()).toBe(false);
  });

  it('cancels preview without publishing history or changing canonical state', () => {
    const state = setup();
    const opening = state.document;
    state.owner.begin();
    state.owner.change(document => ({ ...document, name: 'Transient' }));
    expect(state.preview?.name).toBe('Transient');
    expect(state.owner.cancel()).toBe(true);
    expect(state.document).toBe(opening);
    expect(state.preview).toBeNull();
    expect(state.history).toHaveLength(0);
  });

  it('uses the same mutation owner for discrete changes outside a gesture', () => {
    const state = setup();
    expect(state.owner.change(document => ({ ...document, name: 'Discrete' }))).toBe(true);
    expect(state.document.name).toBe('Discrete');
    expect(state.history).toHaveLength(1);
  });

  it('does not fall through to generic commit after a text-owned false terminal', () => {
    const state = setup();
    state.owner.begin();
    state.owner.change(document => ({ ...document, name: 'Transient' }));
    state.commitTextProperties.mockReturnValue(false);
    expect(state.owner.commitActive()).toBe(false);
    expect(state.history).toHaveLength(0);
    expect(state.mutations.active).toBe(true);
  });

  it('does not reset newer domain state when lifecycle changes during waitForIdle', async () => {
    const state = setup();
    vi.spyOn(state.mutations, 'waitForIdle').mockImplementation(async () => {
      state.replaceLifecycle();
    });
    const cancel = vi.spyOn(state.mutations, 'cancelActive');
    await expect(state.owner.resetForHistory()).rejects.toThrow('retired document renderer');
    expect(state.resetFaceWarp).not.toHaveBeenCalled();
    expect(state.cancelTextProperties).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('cancels current face/text/document previews in existing history order', async () => {
    const state = setup();
    state.owner.begin();
    state.owner.change(document => ({ ...document, name: 'Transient' }));
    await state.owner.resetForHistory();
    expect(state.resetFaceWarp).toHaveBeenCalledOnce();
    expect(state.cancelTextProperties).toHaveBeenCalledOnce();
    expect(state.mutations.active).toBe(false);
    expect(state.history).toHaveLength(0);
  });
});
