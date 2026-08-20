import { createDefaultFlowTextSource, createDefaultTextLayerData } from '@lighttable/text-core';
import { describe, expect, it } from 'vitest';
import { createTextLayer, setLayerLock } from '../../editor/document/documentCommands';
import { createImageDocument, type ImageDocument, type LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  createTextEditTransactionController,
  describeTextReplacement,
  TEXT_EDIT_COALESCING_RULES,
  type TextEditHistoryEntry
} from './textEditTransactionController';

const setup = () => {
  let document: ImageDocument = createTextLayer(
    createImageDocument('Typing', 320, 200, 'background'),
    createDefaultTextLayerData(),
    'Text'
  );
  const history: TextEditHistoryEntry[] = [];
  const dependencies = {
    getDocument: () => document,
    applyDocument: (next: ImageDocument) => { document = next; },
    pushHistory: (entry: TextEditHistoryEntry) => history.push(entry)
  };
  return {
    controller: createTextEditTransactionController(() => dependencies),
    history,
    get document() { return document; },
    set document(next: ImageDocument) { document = next; }
  };
};

const typeText = (value: string) => (text: ReturnType<typeof createDefaultTextLayerData>) => {
  const source = createDefaultFlowTextSource(value);
  return { ...text, source };
};

describe('text edit transaction controller', () => {
  it('coalesces one explicit typing group into one undoable snapshot', () => {
    const state = setup();
    const id = state.document.activeLayerId!;

    expect(state.controller.begin(id, 'typing')).toBe(true);
    expect(state.controller.apply(typeText('T'))).toBe(true);
    expect(state.controller.apply(typeText('Ty'))).toBe(true);
    expect(state.controller.apply(typeText('Type'))).toBe(true);
    const authored = findDocumentLayer(state.document, id);
    expect(authored?.type === 'text' ? authored.text.revisions : null).toEqual({
      content: 3,
      font: 0,
      layout: 0,
      paint: 0,
      path: 0,
      geometry: 0
    });
    expect(state.history).toHaveLength(0);
    expect(state.controller.commit()).toBe(true);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].group).toBe('typing');
    expect(state.history[0].resourceIds).toEqual([]);
    expect(state.history[0].semanticReplacement).toEqual({
      layerId: id, start: 1, end: 4, text: 'ype'
    });

    state.history[0].undo();
    const undone = findDocumentLayer(state.document, id);
    expect(undone?.type === 'text' && undone.text.source.kind === 'flow'
      ? undone.text.source.text
      : null).toBe('Text');
    state.history[0].redo();
    const redone = findDocumentLayer(state.document, id);
    expect(redone?.type === 'text' && redone.text.source.kind === 'flow'
      ? redone.text.source.text
      : null).toBe('Type');
  });

  it('describes replacements only on complete grapheme boundaries', () => {
    expect(describeTextReplacement('layer' as LayerId,
      'A🧑‍🎨Z', 'A🧑‍🚀Z')).toEqual({
      layerId: 'layer', start: 1, end: 6, text: '🧑‍🚀'
    });
  });

  it('uses explicit composition boundaries and cancel restores the exact snapshot', () => {
    const state = setup();
    const before = state.document;
    const id = before.activeLayerId!;

    expect(TEXT_EDIT_COALESCING_RULES.composition).toContain('compositionstart');
    state.controller.begin(id, 'composition');
    state.controller.apply(typeText('編'));
    state.controller.apply(typeText('編集'));
    expect(state.controller.cancel()).toBe(true);
    expect(state.document).toBe(before);
    expect(state.history).toEqual([]);
  });

  it('does not commit an edit after a document switch', () => {
    const state = setup();
    const id = state.document.activeLayerId!;
    state.controller.begin(id, 'typing');
    state.controller.apply(typeText('Changed'));
    state.document = createImageDocument('Other', 32, 24, 'other');

    expect(state.controller.commit()).toBe(false);
    expect(state.history).toEqual([]);
  });

  it('does not absorb an externally published document into text history', () => {
    const state = setup();
    const id = state.document.activeLayerId!;
    state.controller.begin(id, 'typing');
    state.controller.apply(typeText('Draft'));
    const external = { ...state.document, name: 'Externally renamed' };
    state.document = external;

    expect(state.controller.commit()).toBe(false);
    expect(state.document).toBe(external);
    expect(state.history).toEqual([]);
  });

  it('does not overwrite an external publication when cancelling', () => {
    const state = setup();
    const id = state.document.activeLayerId!;
    state.controller.begin(id, 'typing');
    state.controller.apply(typeText('Draft'));
    const external = { ...state.document, name: 'Externally renamed' };
    state.document = external;

    expect(state.controller.cancel()).toBe(false);
    expect(state.document).toBe(external);
  });

  it('ends the edit when the current snapshot changes before apply', () => {
    const state = setup();
    const id = state.document.activeLayerId!;
    state.controller.begin(id, 'typing');
    state.document = { ...state.document, name: 'External' };

    expect(state.controller.apply(typeText('Rejected'))).toBe(false);
    expect(state.controller.active).toBe(false);
    expect(state.document.name).toBe('External');
  });

  it('honors pixel and position locks without partially applying mixed edits', () => {
    const pixelState = setup();
    const pixelId = pixelState.document.activeLayerId!;
    pixelState.document = setLayerLock(pixelState.document, pixelId, 'pixels', true);
    pixelState.controller.begin(pixelId, 'typing');
    expect(pixelState.controller.apply(typeText('Blocked'))).toBe(false);
    expect(pixelState.controller.commit()).toBe(false);

    const positionState = setup();
    const positionId = positionState.document.activeLayerId!;
    positionState.document = setLayerLock(
      positionState.document,
      positionId,
      'position',
      true
    );
    positionState.controller.begin(positionId, 'layout');
    expect(positionState.controller.apply((text) => {
      if (text.source.kind !== 'flow') return text;
      return {
        ...text,
        source: {
          ...text.source,
          layout: {
            mode: 'paragraph',
            frame: { x: 0, y: 0, width: 100, height: 50 },
            overflow: 'clip',
            writingMode: 'horizontal-tb'
          }
        }
      };
    })).toBe(false);
    expect(positionState.controller.commit()).toBe(false);
  });

  it('keeps separately committed input groups as separate undo boundaries', () => {
    const state = setup();
    const id = state.document.activeLayerId!;

    state.controller.begin(id, 'typing');
    state.controller.apply(typeText('First'));
    state.controller.commit();
    state.controller.begin(id, 'composition');
    state.controller.apply(typeText('First編'));
    state.controller.commit();

    expect(state.history.map(({ group }) => group)).toEqual(['typing', 'composition']);
  });
});
