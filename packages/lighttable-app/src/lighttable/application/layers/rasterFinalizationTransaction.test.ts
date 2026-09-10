import { describe, expect, it, vi } from 'vitest';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { findRasterLayer } from '../../editor/document/layerTree';
import {
  createImageDocument,
  type ImageDocument
} from '../../editor/document/documentTypes';
import type { DocumentMutationTransaction } from '../documents/useDocumentMutationController';
import { commitRasterFinalization } from './rasterFinalizationTransaction';

const setup = () => {
  const before = createImageDocument('Before', 16, 12, 'asset');
  const after = createRasterLayer(before, 'Destination');
  const destination = findRasterLayer(after, after.activeLayerId)!;
  let document: ImageDocument = before;
  let processing = 'before';
  const history = {
    commit: vi.fn(() => true),
    cancel: vi.fn()
  };
  const renderer = {
    prepareRasterDestination: vi.fn(() => true),
    commitRasterDestination: vi.fn(),
    releaseRasterDestination: vi.fn(() => true)
  };
  const transaction = {
    stage: vi.fn(() => true),
    cancel: vi.fn(() => true),
    commitWith: vi.fn((commit: (ownedBefore: ImageDocument, ownedAfter: ImageDocument) => boolean) => (
      commit(before, after)
    ))
  } as unknown as DocumentMutationTransaction;
  const reportError = vi.fn();
  const execute = (render: () => boolean = () => true) => commitRasterFinalization({
    renderer,
    reserveHistoryEntry: vi.fn(() => history),
    applyDocumentSnapshot: (next) => { document = next; },
    reportError
  }, transaction, {
    operation: 'Rasterize',
    current: before,
    next: after,
    destination,
    render,
    processing: {
      publish: () => { processing = 'after'; },
      restore: () => { processing = 'before'; }
    },
    historyEntry: { undo: vi.fn(), redo: vi.fn() },
    errorMessage: 'render failed'
  });
  return {
    before, after, destination, renderer, transaction, history, reportError, execute,
    document: () => document,
    processing: () => processing
  };
};

describe('commitRasterFinalization', () => {
  it('makes history durable before releasing the destination reservation', () => {
    const state = setup();
    expect(state.execute()).toBe(true);
    expect(state.document()).toBe(state.after);
    expect(state.processing()).toBe('after');
    expect(state.history.commit).toHaveBeenCalledOnce();
    expect(state.renderer.commitRasterDestination).toHaveBeenCalledWith(state.destination.id);
    expect(state.renderer.releaseRasterDestination).not.toHaveBeenCalled();
    expect(state.history.cancel).not.toHaveBeenCalled();
  });

  it('releases the destination and reservation when rendering fails', () => {
    const state = setup();
    expect(state.execute(() => false)).toBe(false);
    expect(state.document()).toBe(state.before);
    expect(state.processing()).toBe('before');
    expect(state.renderer.releaseRasterDestination).toHaveBeenCalledWith(state.destination.id);
    expect(state.history.cancel).toHaveBeenCalledOnce();
    expect(state.history.commit).not.toHaveBeenCalled();
    expect(state.reportError).toHaveBeenLastCalledWith('render failed');
  });

  it('rolls every published surface back when history admission is invalidated', () => {
    const state = setup();
    state.history.commit.mockReturnValue(false);
    expect(state.execute()).toBe(false);
    expect(state.document()).toBe(state.before);
    expect(state.processing()).toBe('before');
    expect(state.renderer.releaseRasterDestination).toHaveBeenCalledWith(state.destination.id);
    expect(state.history.cancel).toHaveBeenCalledOnce();
    expect(state.renderer.commitRasterDestination).not.toHaveBeenCalled();
  });

  it('keeps a durable command committed when reservation cleanup throws', () => {
    const state = setup();
    state.renderer.commitRasterDestination.mockImplementation(() => {
      throw new Error('cleanup failed');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(state.execute()).toBe(true);
    expect(state.document()).toBe(state.after);
    expect(state.history.commit).toHaveBeenCalledOnce();
    expect(state.renderer.releaseRasterDestination).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
