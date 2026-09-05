import { createDefaultTextLayerData } from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import { createTextLayer } from '../../editor/document/documentCommands';
import { createImageDocument, type ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { FlowTextEditingSessionController } from './flowTextEditingSession';
import type { TextEditHistoryEntry } from './textEditTransactionController';

const setup = (
  initial = 'Text',
  publishHistory?: (entry: TextEditHistoryEntry) => void
) => {
  const data = createDefaultTextLayerData();
  data.source.kind === 'flow' && Object.assign(data, {
    source: { ...data.source, text: initial,
      styleRuns: initial.length
        ? data.source.styleRuns.map((run) => ({ ...run, end: initial.length })) : [],
      paragraphRuns: initial.length
        ? data.source.paragraphRuns.map((run) => ({ ...run, end: initial.length })) : [] }
  });
  let document: ImageDocument = createTextLayer(
    createImageDocument('Edit', 320, 200, 'background'), data, 'Headline'
  );
  const history: TextEditHistoryEntry[] = [];
  const controller = new FlowTextEditingSessionController(() => ({
    getDocument: () => document,
    applyDocument: (next) => { document = next; },
    pushHistory: (entry) => {
      publishHistory?.(entry);
      history.push(entry);
    }
  }));
  const text = () => {
    const layer = findDocumentLayer(document, document.activeLayerId!);
    return layer?.type === 'text' && layer.text.source.kind === 'flow'
      ? layer.text.source.text : '';
  };
  const source = () => {
    const layer = findDocumentLayer(document, document.activeLayerId!);
    return layer?.type === 'text' && layer.text.source.kind === 'flow'
      ? layer.text.source : null;
  };
  return { controller, history, text, source, get document() { return document; }, set document(next) { document = next; } };
};

describe('flow text editing session', () => {
  it('keeps ordinary caret movement off the broad editor-shell subscription', () => {
    const state = setup('abcd');
    const id = state.document.activeLayerId!;
    state.controller.begin(id, 0);
    const fullUpdates: number[] = [];
    const shellUpdates: number[] = [];
    const unsubscribeFull = state.controller.subscribe(() => fullUpdates.push(1));
    const unsubscribeShell = state.controller.subscribeShell(() => shellUpdates.push(1));
    const shellBefore = state.controller.getShellSnapshot();

    state.controller.navigate('forward');
    state.controller.navigate('forward');

    expect(fullUpdates).toHaveLength(2);
    expect(shellUpdates).toHaveLength(0);
    expect(state.controller.getShellSnapshot()).toBe(shellBefore);
    expect(state.controller.getSnapshot().selection.focus).toBe(2);

    state.controller.setSelection({ anchor: 0, focus: 2 }, { transient: true });
    expect(shellUpdates).toHaveLength(0);
    state.controller.setSelection({ anchor: 0, focus: 2 });
    expect(shellUpdates).toHaveLength(1);
    expect(state.controller.getShellSnapshot().selection).toEqual({ anchor: 0, focus: 2 });
    unsubscribeFull();
    unsubscribeShell();
  });

  it('coalesces contiguous typing and commits on caret movement', () => {
    const state = setup('');
    const id = state.document.activeLayerId!;
    state.controller.begin(id);
    state.controller.insert('A');
    state.controller.insert('👋');
    expect(state.history).toHaveLength(0);
    state.controller.navigate('backward');
    expect(state.text()).toBe('A👋');
    expect(state.history.map(({ group }) => group)).toEqual(['typing']);
    expect(state.controller.getSnapshot().selection.focus).toBe(1);
  });

  it('keeps high-frequency typing local until one semantic commit boundary', () => {
    const state = setup('');
    const id = state.document.activeLayerId!;
    const text = 'agent-native-'.repeat(20);
    state.controller.begin(id);
    for (const character of text) state.controller.insert(character);
    expect(state.history).toHaveLength(0);
    expect(state.controller.checkpoint()).toBe(true);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].semanticReplacement).toEqual({
      layerId: id, start: 0, end: 0, text
    });
  });

  it('restores the document and permits a new group when history rejects a commit', () => {
    let reject = true;
    const state = setup('', () => {
      if (reject) throw new Error('History rejected the edit.');
    });
    const id = state.document.activeLayerId!;
    state.controller.begin(id);
    state.controller.insert('A');

    expect(() => state.controller.checkpoint()).toThrow('History rejected the edit.');
    expect(state.text()).toBe('');
    expect(state.history).toHaveLength(0);

    reject = false;
    expect(state.controller.insert('B')).toBe(true);
    expect(state.controller.checkpoint()).toBe(true);
    expect(state.text()).toBe('B');
    expect(state.history).toHaveLength(1);
  });

  it('replaces intermediate IME updates inside one composition history group', () => {
    const state = setup('A');
    const id = state.document.activeLayerId!;
    state.controller.begin(id, 1);
    state.controller.compositionStart();
    state.controller.compositionUpdate('へ');
    state.controller.compositionUpdate('編集');
    state.controller.compositionEnd('編集');
    expect(state.text()).toBe('A編集');
    expect(state.history.map(({ group }) => group)).toEqual(['composition']);
    state.history[0]!.undo();
    expect(state.text()).toBe('A');
  });

  it('finalizes composition state when blur checkpoints before a late compositionend', () => {
    const state = setup('A');
    state.controller.begin(state.document.activeLayerId!, 1);
    state.controller.compositionStart();
    state.controller.compositionUpdate('edit');
    expect(state.controller.checkpoint()).toBe(true);
    expect(state.controller.getSnapshot().compositionRange).toBeNull();
    expect(state.history.map(({ group }) => group)).toEqual(['composition']);
    expect(state.controller.compositionEnd('ignored late event')).toBe(false);
    expect(state.text()).toBe('Aedit');
  });

  it('clears an empty composition on blur even when compositionend never arrives', () => {
    const state = setup('A');
    state.controller.begin(state.document.activeLayerId!, 1);
    state.controller.compositionStart();
    expect(state.controller.checkpoint()).toBe(false);
    expect(state.controller.getSnapshot().compositionRange).toBeNull();
    expect(state.controller.getSnapshot().status).toBe('editing');
  });

  it('keeps paste separate and exposes only the selected clipboard text', () => {
    const state = setup('alpha beta');
    state.controller.begin(state.document.activeLayerId!, 5);
    state.controller.setSelection({ anchor: 0, focus: 5 });
    expect(state.controller.selectedText()).toBe('alpha');
    state.controller.paste('gamma');
    expect(state.text()).toBe('gamma beta');
    expect(state.history).toHaveLength(1);
  });

  it('cancels an open composition without undoing prior committed typing', () => {
    const state = setup('A');
    state.controller.begin(state.document.activeLayerId!, 1);
    state.controller.insert('B');
    state.controller.navigate('backward');
    state.controller.compositionStart();
    state.controller.compositionUpdate('仮');
    expect(state.text()).toBe('A仮B');
    state.controller.cancelComposition();
    expect(state.text()).toBe('AB');
    expect(state.history.map(({ group }) => group)).toEqual(['typing']);
  });

  it('drops stale sessions after a document switch', () => {
    const state = setup('A');
    state.controller.begin(state.document.activeLayerId!, 1);
    state.document = createImageDocument('Other', 10, 10, 'other');
    expect(state.controller.insert('lost')).toBe(false);
    expect(state.controller.getSnapshot().status).toBe('idle');
    expect(state.history).toHaveLength(0);
  });

  it('splits delete history when direction changes', () => {
    const state = setup('abc');
    state.controller.begin(state.document.activeLayerId!, 1);
    state.controller.delete('forward');
    state.controller.delete('backward');
    state.controller.finish();
    expect(state.text()).toBe('c');
    expect(state.history.map(({ group }) => group)).toEqual(['delete', 'delete']);
  });

  it('retains authored insertion styling after deleting all text and reopening', () => {
    const state = setup('Styled');
    const id = state.document.activeLayerId!;
    const original = state.source()!;
    const styledSource = {
      ...original,
      styleRuns: original.styleRuns.map((run) => ({ ...run, fontSize: 73, fontWeight: 700 }))
    };
    state.document = {
      ...state.document,
      layers: state.document.layers.map((entry) => entry.id === id && entry.type === 'text'
        ? { ...entry, text: { ...entry.text, source: styledSource } }
        : entry)
    };
    state.controller.begin(id);
    state.controller.selectAll();
    state.controller.delete('backward');
    state.controller.finish();
    expect(state.source()?.insertionStyle?.fontSize).toBe(73);
    state.controller.begin(id);
    state.controller.insert('N');
    state.controller.finish();
    expect(state.source()?.styleRuns[0]).toMatchObject({ fontSize: 73, fontWeight: 700 });
  });

  it('coalesces a character property gesture and preserves mixed runs outside its range', () => {
    const state = setup('abcd');
    state.controller.begin(state.document.activeLayerId!, 1);
    state.controller.setSelection({ anchor: 1, focus: 3 });
    expect(state.controller.beginFormatting()).toBe(true);
    expect(state.controller.format({ tracking: 10 })).toBe(true);
    expect(state.controller.format({ tracking: 20 })).toBe(true);
    expect(state.controller.endFormatting()).toBe(true);
    expect(state.history.map(({ group }) => group)).toEqual(['format']);
    expect(state.source()?.styleRuns.map(({ start, end, tracking }) => ({ start, end, tracking })))
      .toEqual([
        { start: 0, end: 1, tracking: 0 },
        { start: 1, end: 3, tracking: 20 },
        { start: 3, end: 4, tracking: 0 }
      ]);
  });

  it('uses collapsed-caret formatting for subsequently inserted text', () => {
    const state = setup('ab');
    state.controller.begin(state.document.activeLayerId!, 1);
    state.controller.beginFormatting();
    state.controller.format({ fontSize: 42 });
    state.controller.endFormatting();
    state.controller.insert('X');
    state.controller.finish();
    expect(state.source()?.styleRuns.map(({ start, end, fontSize }) => ({ start, end, fontSize })))
      .toEqual([
        { start: 0, end: 1, fontSize: 16 },
        { start: 1, end: 2, fontSize: 42 },
        { start: 2, end: 3, fontSize: 16 }
      ]);
  });

  it('restores the opening runs when a property gesture is cancelled', () => {
    const state = setup('ab');
    state.controller.begin(state.document.activeLayerId!);
    state.controller.selectAll();
    state.controller.beginFormatting();
    state.controller.format({ fontSize: 99 });
    expect(state.source()?.styleRuns[0].fontSize).toBe(99);
    expect(state.controller.cancelFormatting()).toBe(true);
    expect(state.source()?.styleRuns[0].fontSize).toBe(16);
    expect(state.history).toHaveLength(0);
  });
});
