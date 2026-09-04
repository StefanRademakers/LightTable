import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type ImageDocument } from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import type { FillHistoryEntry } from './useFillCommandController';
import { createFillCommandController } from './useFillCommandController';

const pixelEdit = (): ReversiblePixelEdit => ({
  byteSize: 48,
  undo: vi.fn(() => true),
  redo: vi.fn(() => true),
  destroy: vi.fn()
});

describe('createFillCommandController', () => {
  it('publishes one document snapshot and one reversible history entry', () => {
    let document: ImageDocument = createImageDocument('Fill', 16, 12, 'asset');
    const before = document;
    const edit = pixelEdit();
    const history: FillHistoryEntry[] = [];
    const renderer = {
      beginBrushStroke: vi.fn(),
      fillLayerColor: vi.fn(() => true),
      finishPixelEdit: vi.fn(() => edit),
      cancelPixelEdit: vi.fn(),
      applyPixelHistory: vi.fn(() => true)
    };
    const dependencies = {
      getDocument: () => document,
      getRenderer: () => renderer,
      getChannel: () => 'pixels' as const,
      applyDocumentSnapshot: vi.fn((next: ImageDocument) => {
        document = next;
      }),
      pushHistoryEntry: vi.fn((entry: FillHistoryEntry) => history.push(entry)),
      setStatus: vi.fn(),
      setError: vi.fn(),
      onFillCommitted: vi.fn()
    };
    const controller = createFillCommandController(() => dependencies);

    expect(controller.fill('#ff0000')).toBe(true);
    expect(document.revision).toBeGreaterThan(before.revision);
    expect(history).toHaveLength(1);
    expect(dependencies.setStatus).toHaveBeenCalledWith(
      expect.stringContaining('#FF0000')
    );
    expect(dependencies.onFillCommitted).toHaveBeenCalledWith(
      expect.objectContaining({ layerId: before.activeLayerId, channel: 'pixels',
        color: '#ff0000', opacity: 1 }),
      { layerId: before.activeLayerId, channel: 'pixels' }
    );

    history[0].undo();
    expect(document).toBe(before);
    expect(renderer.applyPixelHistory).toHaveBeenCalledWith(edit, 'undo');

    history[0].redo();
    expect(document).not.toBe(before);
    expect(renderer.applyPixelHistory).toHaveBeenCalledWith(edit, 'redo');
  });

  it('targets commands explicitly without recursively observing them', () => {
    let document: ImageDocument = createImageDocument('Fill command', 16, 12, 'asset');
    const renderer = { beginBrushStroke: vi.fn(), fillLayerColor: vi.fn(() => true),
      finishPixelEdit: vi.fn(() => pixelEdit()), cancelPixelEdit: vi.fn(),
      applyPixelHistory: vi.fn(() => true) };
    const onFillCommitted = vi.fn();
    const controller = createFillCommandController(() => ({
      getDocument: () => document, getRenderer: () => renderer, getChannel: () => 'mask',
      applyDocumentSnapshot: (next) => { document = next; }, pushHistoryEntry: vi.fn(),
      setStatus: vi.fn(), setError: vi.fn(), onFillCommitted
    }));
    const layerId = document.activeLayerId!;
    expect(controller.apply({ layerId, channel: 'pixels', color: '#ffffff', opacity: 0.5 }))
      .toEqual({ layerId, channel: 'pixels' });
    expect(renderer.fillLayerColor).toHaveBeenCalledWith(layerId, 'pixels', [1, 1, 1], false, 0.5);
    expect(onFillCommitted).not.toHaveBeenCalled();
  });

  it('uses the same reversible GPU transaction for clearing selected pixels', () => {
    let document: ImageDocument = createImageDocument('Clear', 16, 12, 'asset');
    const history: FillHistoryEntry[] = [];
    const renderer = {
      beginBrushStroke: vi.fn(),
      fillLayerColor: vi.fn(() => true),
      finishPixelEdit: vi.fn(() => pixelEdit()),
      cancelPixelEdit: vi.fn(),
      applyPixelHistory: vi.fn(() => true)
    };
    const dependencies = {
      getDocument: () => document,
      getRenderer: () => renderer,
      getChannel: () => 'pixels' as const,
      applyDocumentSnapshot: vi.fn((next: ImageDocument) => { document = next; }),
      pushHistoryEntry: vi.fn((entry: FillHistoryEntry) => history.push(entry)),
      setStatus: vi.fn(),
      setError: vi.fn()
    };

    expect(createFillCommandController(() => dependencies).clearSelection()).toBe(true);
    expect(renderer.fillLayerColor).toHaveBeenCalledWith(
      document.activeLayerId,
      'pixels',
      [0, 0, 0],
      false,
      0
    );
    expect(history).toHaveLength(1);
    expect(dependencies.setStatus).toHaveBeenCalledWith('Background selection cleared');
  });

  it('does not publish history when the renderer rejects the fill', () => {
    const document = createImageDocument('Fill', 16, 12, 'asset');
    const dependencies = {
      getDocument: () => document,
      getRenderer: () => ({
        beginBrushStroke: vi.fn(),
        fillLayerColor: vi.fn(() => false),
        finishPixelEdit: vi.fn(() => null),
        cancelPixelEdit: vi.fn(),
        applyPixelHistory: vi.fn(() => true)
      }),
      getChannel: () => 'pixels' as const,
      applyDocumentSnapshot: vi.fn(),
      pushHistoryEntry: vi.fn(),
      setStatus: vi.fn(),
      setError: vi.fn()
    };

    expect(createFillCommandController(() => dependencies).fill('#ffffff')).toBe(false);
    expect(dependencies.applyDocumentSnapshot).not.toHaveBeenCalled();
    expect(dependencies.pushHistoryEntry).not.toHaveBeenCalled();
    expect(dependencies.setError).toHaveBeenCalledWith(
      expect.stringContaining('not available')
    );
  });

  it('rolls the GPU edit back when canonical document publication fails', () => {
    let document: ImageDocument = createImageDocument('Fill', 16, 12, 'asset');
    const before = document;
    const edit = pixelEdit();
    let publications = 0;
    const renderer = {
      beginBrushStroke: vi.fn(), fillLayerColor: vi.fn(() => true),
      finishPixelEdit: vi.fn(() => edit), cancelPixelEdit: vi.fn(),
      applyPixelHistory: vi.fn(() => true)
    };
    const dependencies = {
      getDocument: () => document, getRenderer: () => renderer,
      getChannel: () => 'pixels' as const,
      applyDocumentSnapshot: vi.fn((next: ImageDocument) => {
        document = next;
        publications += 1;
        if (publications === 1) throw new Error('publication failed');
      }),
      pushHistoryEntry: vi.fn(), setStatus: vi.fn(), setError: vi.fn()
    };

    expect(createFillCommandController(() => dependencies).fill('#ffffff')).toBe(false);
    expect(document).toBe(before);
    expect(renderer.applyPixelHistory).toHaveBeenCalledWith(edit, 'undo');
    expect(edit.destroy).toHaveBeenCalledOnce();
    expect(dependencies.pushHistoryEntry).not.toHaveBeenCalled();
    expect(dependencies.setStatus).not.toHaveBeenCalled();
  });

  it('rolls canonical and GPU state back when history rejects ownership', () => {
    let document: ImageDocument = createImageDocument('Fill', 16, 12, 'asset');
    const before = document;
    const edit = pixelEdit();
    const renderer = {
      beginBrushStroke: vi.fn(), fillLayerColor: vi.fn(() => true),
      finishPixelEdit: vi.fn(() => edit), cancelPixelEdit: vi.fn(),
      applyPixelHistory: vi.fn(() => true)
    };
    const dependencies = {
      getDocument: () => document, getRenderer: () => renderer,
      getChannel: () => 'pixels' as const,
      applyDocumentSnapshot: vi.fn((next: ImageDocument) => { document = next; }),
      pushHistoryEntry: vi.fn(() => { throw new Error('history failed'); }),
      setStatus: vi.fn(), setError: vi.fn()
    };

    expect(createFillCommandController(() => dependencies).fill('#ffffff')).toBe(false);
    expect(document).toBe(before);
    expect(renderer.applyPixelHistory).toHaveBeenCalledWith(edit, 'undo');
    expect(edit.destroy).toHaveBeenCalledOnce();
    expect(dependencies.setStatus).not.toHaveBeenCalled();
  });

  it('compensates GPU and document state when undo publication fails', () => {
    let document: ImageDocument = createImageDocument('Fill', 16, 12, 'asset');
    const edit = pixelEdit();
    const history: FillHistoryEntry[] = [];
    let rejectPublication = false;
    const renderer = {
      beginBrushStroke: vi.fn(), fillLayerColor: vi.fn(() => true),
      finishPixelEdit: vi.fn(() => edit), cancelPixelEdit: vi.fn(),
      applyPixelHistory: vi.fn(() => true)
    };
    const dependencies = {
      getDocument: () => document, getRenderer: () => renderer,
      getChannel: () => 'pixels' as const,
      applyDocumentSnapshot: vi.fn((next: ImageDocument) => {
        document = next;
        if (rejectPublication) {
          rejectPublication = false;
          throw new Error('undo publication failed');
        }
      }),
      pushHistoryEntry: (entry: FillHistoryEntry) => history.push(entry),
      setStatus: vi.fn(), setError: vi.fn()
    };
    const controller = createFillCommandController(() => dependencies);
    expect(controller.fill('#ffffff')).toBe(true);
    const after = document;
    rejectPublication = true;

    expect(() => history[0]!.undo()).toThrow('undo publication failed');
    expect(document).toBe(after);
    expect(renderer.applyPixelHistory.mock.calls.slice(-2)).toEqual([
      [edit, 'undo'],
      [edit, 'redo']
    ]);
  });

  it('compensates GPU and document state when redo publication fails', () => {
    let document: ImageDocument = createImageDocument('Fill', 16, 12, 'asset');
    const before = document;
    const edit = pixelEdit();
    const history: FillHistoryEntry[] = [];
    let rejectPublication = false;
    const renderer = {
      beginBrushStroke: vi.fn(), fillLayerColor: vi.fn(() => true),
      finishPixelEdit: vi.fn(() => edit), cancelPixelEdit: vi.fn(),
      applyPixelHistory: vi.fn(() => true)
    };
    const dependencies = {
      getDocument: () => document, getRenderer: () => renderer,
      getChannel: () => 'pixels' as const,
      applyDocumentSnapshot: vi.fn((next: ImageDocument) => {
        document = next;
        if (rejectPublication) {
          rejectPublication = false;
          throw new Error('redo publication failed');
        }
      }),
      pushHistoryEntry: (entry: FillHistoryEntry) => history.push(entry),
      setStatus: vi.fn(), setError: vi.fn()
    };
    const controller = createFillCommandController(() => dependencies);
    expect(controller.fill('#ffffff')).toBe(true);
    history[0]!.undo();
    expect(document).toBe(before);
    rejectPublication = true;

    expect(() => history[0]!.redo()).toThrow('redo publication failed');
    expect(document).toBe(before);
    expect(renderer.applyPixelHistory.mock.calls.slice(-2)).toEqual([
      [edit, 'redo'],
      [edit, 'undo']
    ]);
  });
});
