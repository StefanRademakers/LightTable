import { createDefaultTextLayerData } from '@lighttable/text-core';
import { describe, expect, it, vi } from 'vitest';
import { createTextLayer } from '../../editor/document/documentCommands';
import { createImageDocument, type ImageDocument, type LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import type { DocumentSessionId } from '../documents/documentSession';
import { FlowTextEditingSessionController } from './flowTextEditingSession';
import { TextPropertyGestureController } from './TextPropertyGestureController';

const idleEditing = () => ({
  getSnapshot: () => ({ status: 'idle', layerId: null }),
  beginFormatting: vi.fn(), format: vi.fn(), endFormatting: vi.fn(),
  cancelFormatting: vi.fn(), finish: vi.fn()
}) as unknown as FlowTextEditingSessionController;

describe('TextPropertyGestureController', () => {
  it.each(['noop', 'changed', 'blocked', 'stale', 'canceled', 'failed'] as const)(
    'uses the actual flow formatting terminal before transition: %s', mode => {
      let document = createTextLayer(createImageDocument('Text', 320, 200, 'background'),
        createDefaultTextLayerData(), 'Headline');
      let blocked = false;
      const failure = new Error('History admission failed');
      const history = vi.fn(() => { if (mode === 'failed') throw failure; });
      const mutations = createDocumentMutationController(() => ({
        getDocument: () => document, applySnapshot: next => { document = next; },
        previewSnapshot: vi.fn(), discardPreview: vi.fn(), pushHistoryEntry: history,
        isMutationBlocked: () => blocked
      }));
      const editing = new FlowTextEditingSessionController(() => ({
        getDocument: () => document, documentMutations: mutations,
        onCommitted: vi.fn(), reportError: vi.fn(), requestPreviewFrame: () => 1, cancelPreviewFrame: vi.fn()
      }));
      const record = vi.fn();
      const controller = new TextPropertyGestureController(() => ({
        getDocument: () => document, getCommandDocumentId: () => 'source' as DocumentSessionId,
        documentMutations: mutations, textEditing: editing, recordObservedCommand: record,
        reportError: vi.fn(), requestFrame: () => 1, cancelFrame: vi.fn()
      }));
      expect(editing.begin(document.activeLayerId!)).toBe(true);
      expect(controller.begin(document.activeLayerId)).toBe(true);
      if (mode !== 'noop') controller.apply({ fontSize: 48 });
      if (mode === 'blocked') blocked = true;
      if (mode === 'stale') document = { ...document, revision: document.revision + 1 };
      if (mode === 'canceled') mutations.cancelActive();
      const next = vi.fn();
      if (mode === 'failed') {
        expect(() => controller.finishBeforeTransition(next)).toThrow(failure);
        expect(next).not.toHaveBeenCalled(); return;
      }
      const accepted = mode === 'noop' || mode === 'changed';
      expect(controller.finishBeforeTransition(next)).toBe(accepted);
      expect(next).toHaveBeenCalledTimes(accepted ? 1 : 0);
      expect(history).toHaveBeenCalledTimes(mode === 'changed' ? 1 : 0);
      expect(record).toHaveBeenCalledTimes(mode === 'changed' ? 1 : 0);
      if (accepted) expect(editing.getSnapshot().status).toBe('idle');
    });

  it.each(['noop', 'changed', 'blocked', 'stale', 'canceled', 'failed'] as const)(
    'admits a workspace transition only after an accepted document terminal: %s', (mode) => {
      let document = createTextLayer(createImageDocument('Text', 320, 200, 'background'),
        createDefaultTextLayerData(), 'Headline');
      let blocked = false;
      const failure = new Error('History admission failed');
      const history = vi.fn(() => { if (mode === 'failed') throw failure; });
      const record = vi.fn();
      const mutations = createDocumentMutationController(() => ({
        getDocument: () => document,
        applySnapshot: next => { document = next; },
        previewSnapshot: vi.fn(), discardPreview: vi.fn(),
        pushHistoryEntry: history, isMutationBlocked: () => blocked
      }));
      const controller = new TextPropertyGestureController(() => ({
        getDocument: () => document, getCommandDocumentId: () => 'source' as DocumentSessionId,
        documentMutations: mutations, textEditing: idleEditing(), recordObservedCommand: record,
        reportError: vi.fn(), requestFrame: () => 1, cancelFrame: vi.fn()
      }));
      expect(controller.begin(document.activeLayerId)).toBe(true);
      if (mode !== 'noop') controller.queuePaint({ fontSize: 48 });
      // Flush before rejection to prove an authored (not merely untouched) gesture.
      controller.flushPaint();
      if (mode === 'blocked') blocked = true;
      if (mode === 'stale') document = { ...document, revision: document.revision + 1 };
      if (mode === 'canceled') mutations.cancelActive();
      const transition = vi.fn();
      if (mode === 'failed') {
        expect(() => controller.finishBeforeTransition(transition)).toThrow(failure);
        expect(transition).not.toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
        return;
      }
      const accepted = mode === 'noop' || mode === 'changed';
      expect(controller.finishBeforeTransition(transition)).toBe(accepted);
      expect(transition).toHaveBeenCalledTimes(accepted ? 1 : 0);
      expect(history).toHaveBeenCalledTimes(mode === 'changed' ? 1 : 0);
      expect(record).toHaveBeenCalledTimes(mode === 'changed' ? 1 : 0);
    });

  it('coalesces document paint samples and records one terminal semantic command', () => {
    let document: ImageDocument = createTextLayer(
      createImageDocument('Text', 320, 200, 'background'),
      createDefaultTextLayerData(), 'Headline'
    );
    let preview = document;
    const history: unknown[] = [];
    const frames = new Map<number, () => void>();
    let nextFrame = 1;
    const record = vi.fn();
    const mutations = createDocumentMutationController(() => ({
      getDocument: () => document,
      applySnapshot: (next) => { document = next; preview = next; },
      previewSnapshot: (next) => { preview = next; },
      discardPreview: () => { preview = document; },
      pushHistoryEntry: (entry) => history.push(entry)
    }));
    const controller = new TextPropertyGestureController(() => ({
      getDocument: () => document,
      getCommandDocumentId: () => document.id as unknown as DocumentSessionId,
      documentMutations: mutations,
      textEditing: idleEditing(),
      recordObservedCommand: record,
      reportError: (message) => { throw new Error(message); },
      requestFrame: (callback) => { const id = nextFrame++; frames.set(id, callback); return id; },
      cancelFrame: (frame) => { frames.delete(frame); }
    }));

    expect(controller.begin(document.activeLayerId)).toBe(true);
    controller.queuePaint({ fill: {
      kind: 'solid', color: { colorSpace: 'srgb', r: 1, g: 0, b: 0, a: 1 }
    } });
    controller.queuePaint({ fill: {
      kind: 'solid', color: { colorSpace: 'srgb', r: 0, g: 0, b: 1, a: 1 }
    } });
    expect(frames.size).toBe(1);
    expect(controller.commit()).toBe(true);
    expect(frames.size).toBe(0);
    expect(history).toHaveLength(1);
    expect(record).toHaveBeenCalledOnce();
    const layer = findDocumentLayer(preview, document.activeLayerId!);
    expect(layer?.type === 'text' && layer.text.source.kind === 'flow'
      ? layer.text.source.styleRuns[0]?.fill
      : null).toMatchObject({ kind: 'solid', color: { b: 1 } });
  });

  it('keeps an editing-range gesture in the text transaction and cancels cleanly', () => {
    const format = vi.fn();
    const cancelFormatting = vi.fn(() => true);
    const editing = {
      getSnapshot: () => ({
        status: 'editing', layerId: 'text-1',
        selection: { anchor: 7, focus: 2 }
      }),
      beginFormatting: vi.fn(() => true), format,
      endFormattingResult: vi.fn(() => 'committed'), cancelFormatting, finish: vi.fn()
    } as unknown as FlowTextEditingSessionController;
    const document = { id: 'doc-1', activeLayerId: 'text-1' } as ImageDocument;
    const controller = new TextPropertyGestureController(() => ({
      getDocument: () => document,
      getCommandDocumentId: () => 'doc-1' as DocumentSessionId,
      documentMutations: { begin: vi.fn() }, textEditing: editing,
      recordObservedCommand: vi.fn(), reportError: vi.fn(),
      requestFrame: vi.fn(), cancelFrame: vi.fn()
    }));

    expect(controller.begin('text-1' as LayerId)).toBe(true);
    expect(controller.apply({ fontSize: 42 })).toBe(true);
    expect(format).toHaveBeenCalledWith({ fontSize: 42 }, {});
    expect(controller.cancel()).toBe(true);
    expect(cancelFormatting).toHaveBeenCalledOnce();
  });

  it('commits and observes document A before a workspace transition reaches document B', () => {
    const layerId = 'text-1' as LayerId;
    const order: string[] = [];
    const frames = new Map<number, () => void>();
    let nextFrame = 1;
    let commandDocumentId = 'document-a' as DocumentSessionId;
    const record = vi.fn((..._arguments: unknown[]) => { order.push('observe-a'); });
    const editing = {
      getSnapshot: () => ({
        status: 'editing', layerId, selection: { anchor: 1, focus: 4 }
      }),
      beginFormatting: vi.fn(() => true),
      format: vi.fn(),
      endFormattingResult: vi.fn(() => { order.push('commit-a'); return 'committed'; }),
      cancelFormatting: vi.fn(),
      finish: vi.fn(() => { order.push('finish-editor-a'); return true; })
    } as unknown as FlowTextEditingSessionController;
    const controller = new TextPropertyGestureController(() => ({
      getDocument: () => ({ id: 'source-a', activeLayerId: layerId } as ImageDocument),
      getCommandDocumentId: () => commandDocumentId,
      documentMutations: { begin: vi.fn() }, textEditing: editing,
      recordObservedCommand: record,
      reportError: (message) => { throw new Error(message); },
      requestFrame: (callback) => { const id = nextFrame++; frames.set(id, callback); return id; },
      cancelFrame: (frame) => { frames.delete(frame); }
    }));

    expect(controller.begin(layerId)).toBe(true);
    controller.queuePaint({ fontSize: 48 });
    commandDocumentId = 'document-b' as DocumentSessionId;
    expect(controller.finishBeforeTransition(() => order.push('activate-b'))).toBe(true);

    expect(frames.size).toBe(0);
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]?.[1]).toBe('document-a');
    expect(order).toEqual(['commit-a', 'observe-a', 'finish-editor-a', 'activate-b']);
  });
});
