import { describe, expect, it } from 'vitest';
import { createPositionedTextFixture } from '@lighttable/text-core';
import { createTextLayer } from '../../editor/document/documentCommands';
import { createImageDocument } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import {
  createDocumentMutationController,
  type DocumentMutationHistoryEntry
} from '../documents/useDocumentMutationController';
import { PositionedTextRecoveryCommandController } from './PositionedTextRecoveryCommandController';

const harness = () => {
  const fixture = createPositionedTextFixture();
  if (fixture.source.kind !== 'positioned') throw new Error('Expected positioned fixture.');
  let document = createTextLayer(
    createImageDocument('Recovery', 100, 50, 'asset'),
    { ...fixture, source: { ...fixture.source, editability: 'recoverable' } },
    'Imported text'
  );
  const opening = document;
  const history: DocumentMutationHistoryEntry[] = [];
  const documentMutations = createDocumentMutationController(() => ({
    getDocument: () => document,
    applySnapshot: next => { document = next; },
    previewSnapshot: next => { document = next; },
    discardPreview: () => undefined,
    pushHistoryEntry: entry => history.push(entry)
  }));
  const controller = new PositionedTextRecoveryCommandController(() => ({
    getDocument: () => document,
    documentMutations
  }));
  return {
    controller, opening, history,
    document: () => document,
    replaceDocument: (next: typeof document) => { document = next; }
  };
};

describe('PositionedTextRecoveryCommandController', () => {
  it('queries confidence without mutation and commits one reversible snapshot', () => {
    const state = harness();
    const layerId = state.opening.activeLayerId!;

    expect(state.controller.analyze(layerId)).toMatchObject({
      status: 'available', confidence: expect.any(Number),
      preview: { source: { kind: 'flow', text: 'A' } }
    });
    expect(state.document()).toBe(state.opening);
    const source = findDocumentLayer(state.opening, layerId)!;
    if (source.type !== 'text' || source.text.source.kind !== 'positioned') throw new Error('Expected positioned text.');
    expect(state.controller.recover(layerId, source.text.source)).toBe(true);
    expect(state.history).toHaveLength(1);
    const recovered = state.document();
    expect(findDocumentLayer(state.document(), layerId)).toMatchObject({
      type: 'text', text: { source: { kind: 'flow', text: 'A' } }
    });

    state.history[0]!.undo();
    expect(findDocumentLayer(state.document(), layerId)).toMatchObject({
      text: { source: { kind: 'positioned' } }
    });
    state.history[0]!.redo();
    expect(state.document()).toBe(recovered);
    expect(findDocumentLayer(state.document(), layerId)).toMatchObject({
      text: { source: { kind: 'flow' } }
    });
  });

  it('rejects stale snapshots, ordinary flow text and blocked recovery', () => {
    const state = harness();
    const layerId = state.opening.activeLayerId!;
    const originalApply = state.controller.recover.bind(state.controller);
    const source = findDocumentLayer(state.opening, layerId)!;
    if (source.type !== 'text' || source.text.source.kind !== 'positioned') throw new Error('Expected positioned text.');
    expect(originalApply(layerId, source.text.source)).toBe(true);
    expect(state.controller.analyze(layerId)).toBeNull();
    expect(state.controller.recover(layerId, source.text.source)).toBe(false);

    const fixture = harness();
    const positioned = findDocumentLayer(fixture.opening, fixture.opening.activeLayerId!);
    if (positioned?.type !== 'text' || positioned.text.source.kind !== 'positioned') {
      throw new Error('Expected positioned fixture.');
    }
    fixture.replaceDocument(createTextLayer(
      createImageDocument('Blocked', 100, 50, 'asset'),
      {
        ...positioned.text,
        source: { ...positioned.text.source, editability: 'outline-only' }
      },
      'Outline text'
    ));
    expect(fixture.controller.analyze(fixture.document().activeLayerId!)).toMatchObject({ status: 'blocked' });
    const blocked = findDocumentLayer(fixture.document(), fixture.document().activeLayerId!);
    if (blocked?.type !== 'text' || blocked.text.source.kind !== 'positioned') throw new Error('Expected blocked source.');
    expect(fixture.controller.recover(blocked.id, blocked.text.source)).toBe(false);
    expect(fixture.history).toHaveLength(0);
  });

  it('rejects an equal-ID positioned source replacement inside the mutation recipe', () => {
    const state = harness(), layer = findDocumentLayer(state.opening, state.opening.activeLayerId!);
    if (layer?.type !== 'text' || layer.text.source.kind !== 'positioned') throw new Error('Expected positioned source.');
    state.replaceDocument({ ...state.opening, layers: state.opening.layers.map(current => current.id === layer.id
      ? { ...layer, text: { ...layer.text, source: { ...layer.text.source } } } : current) });
    const before = state.document();
    expect(state.controller.recover(layer.id, layer.text.source)).toBe(false);
    expect(state.document()).toBe(before); expect(state.history).toHaveLength(0);
  });
});
