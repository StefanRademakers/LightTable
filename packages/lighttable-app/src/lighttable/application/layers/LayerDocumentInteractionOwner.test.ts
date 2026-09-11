import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type ImageDocument } from '../../editor/document/documentTypes';
import { createDocumentMutationController, type DocumentMutationHistoryEntry } from '../documents/useDocumentMutationController';
import { captureInteractionScope } from '../interactions/captureInteractionScope';
import { LayerDocumentInteractionOwner, type LayerDocumentInteractionBinding } from './LayerDocumentInteractionOwner';

const setup = () => {
  let document = createImageDocument('Opening', 32, 24, 'one');
  let preview: ImageDocument | null = null;
  let lifecycle = {};
  const renderer = {};
  const history: DocumentMutationHistoryEntry[] = [];
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => document,
    applySnapshot: next => { document = next; },
    previewSnapshot: next => { preview = next; },
    discardPreview: () => { preview = null; },
    pushHistoryEntry: entry => { history.push(entry); }
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
    rebindProvider: () => { bindingProvider = () => capture(); }
  };
};

describe('layer document interaction ownership', () => {
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
