import { createDefaultTextLayerData } from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import { createTextLayer } from '../../editor/document/documentCommands';
import { createImageDocument, type ImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { FlowTextEditingSessionController } from './flowTextEditingSession';
import type { TextEditHistoryEntry } from './textEditTransactionController';

const setup = (initial = 'Text') => {
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
    pushHistory: (entry) => history.push(entry)
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
});
