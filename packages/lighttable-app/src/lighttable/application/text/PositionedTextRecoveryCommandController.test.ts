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
    expect(state.controller.recover(layerId)).toBe(true);
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
    expect(originalApply(layerId)).toBe(true);
    expect(state.controller.analyze(layerId)).toBeNull();
    expect(state.controller.recover(layerId)).toBe(false);

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
    expect(fixture.controller.recover(fixture.document().activeLayerId!)).toBe(false);
    expect(fixture.history).toHaveLength(0);
  });
});
