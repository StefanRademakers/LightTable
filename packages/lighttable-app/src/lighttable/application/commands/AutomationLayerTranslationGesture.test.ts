import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, createGroupLayer, type ImageDocument, type LayerId } from '../../editor/document/documentTypes';
import { findDocumentLayer } from '../../editor/document/layerTree';
import { createDocumentMutationController, type DocumentMutationHistoryEntry } from '../documents/useDocumentMutationController';
import { AutomationLayerTranslationGesture } from './AutomationLayerTranslationGesture';

const fixture = (mutate: (document: ImageDocument) => ImageDocument = d => d) => {
  let document = mutate(createImageDocument('Translate', 200, 200, 'asset'));
  const before = document;
  let preview: ImageDocument | null = null;
  let current = true; let blocked = false;
  const history: DocumentMutationHistoryEntry[] = [];
  const discardPreview = vi.fn(() => { preview = null; });
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => document, previewSnapshot: next => { preview = next; }, discardPreview,
    applySnapshot: next => { document = next; preview = null; },
    pushHistoryEntry: entry => { history.push(entry); }, isMutationBlocked: () => blocked
  }));
  const owner = new AutomationLayerTranslationGesture({ getDocument: () => document, documentMutations: mutations });
  const scope = { isCurrent: () => current };
  return { owner, before, mutations, history, discardPreview, scope,
    get document() { return document; }, get preview() { return preview; },
    retire: () => { current = false; }, block: () => { blocked = true; },
    replace: (next: ImageDocument) => { document = next; } };
};

describe('AutomationLayerTranslationGesture', () => {
  it('uses one immutable baseline, one history entry and exact undo/redo', () => {
    const f = fixture(); const id = f.before.activeLayerId!;
    expect(f.owner.begin(7, id, { x: 10, y: 20 }, f.scope)).toBe(true);
    expect(f.owner.update(7, { x: 22, y: 27 })).toBe(true);
    expect(f.owner.update(7, { x: 30, y: 32 })).toBe(true);
    expect(f.document).toBe(f.before);
    expect(findDocumentLayer(f.preview!, id)?.transform).toMatchObject({ tx: 20, ty: 12 });
    expect(f.owner.finish(7, true)).toBe(true);
    expect(f.history).toHaveLength(1);
    const after = f.document; f.history[0].undo(); expect(f.document).toBe(f.before);
    f.history[0].redo(); expect(f.document).toBe(after);
  });
  it('ignores a wrong pointer without consuming the rightful gesture', () => {
    const f = fixture(); f.owner.begin(7, f.before.activeLayerId!, { x: 0, y: 0 }, f.scope);
    expect(f.owner.update(8, { x: 10, y: 10 })).toBe(false);
    expect(f.owner.finish(8, true)).toBe(false);
    expect(f.owner.finish(7, false)).toBe(true);
    expect(f.document).toBe(f.before); expect(f.history).toHaveLength(0);
  });
  it('accepts a zero-delta terminal and return-to-origin without history', () => {
    const f = fixture(); f.owner.begin(7, f.before.activeLayerId!, { x: 0, y: 0 }, f.scope);
    expect(f.owner.update(7, { x: 0, y: 0 })).toBe(true);
    f.owner.update(7, { x: 20, y: 30 }); f.owner.update(7, { x: 0, y: 0 });
    expect(f.owner.finish(7, true)).toBe(true);
    expect(f.document).toBe(f.before); expect(f.history).toHaveLength(0);
  });
  it.each(['scope', 'blocked', 'canonical'] as const)('rejects %s retirement instead of committing stale preview', kind => {
    const f = fixture(); f.owner.begin(7, f.before.activeLayerId!, { x: 0, y: 0 }, f.scope);
    f.owner.update(7, { x: 20, y: 30 });
    if (kind === 'scope') f.retire();
    else if (kind === 'blocked') f.block();
    else f.replace({ ...f.before, revision: f.before.revision + 1 });
    expect(f.owner.finish(7, true)).toBe(false);
    expect(f.history).toHaveLength(0); expect(f.preview).toBeNull();
  });
  it('does not let a superseded pointer cancel or mutate its successor', () => {
    const f = fixture(); const id = f.before.activeLayerId!;
    f.owner.begin(7, id, { x: 0, y: 0 }, f.scope);
    f.owner.update(7, { x: 20, y: 30 });
    const successor = f.mutations.begin('another-tool')!;
    expect(f.owner.finish(7, false)).toBe(false);
    expect(successor.active).toBe(true);
  });
  it('projects document deltas through a rotated/scaled parent', () => {
    let childId: LayerId;
    const f = fixture(document => {
      const child = document.layers[0]; childId = child.id;
      const group = { ...createGroupLayer('Parent'), children: [child],
        transform: { a: 0, b: 2, c: -2, d: 0, tx: 15, ty: 25 } };
      return { ...document, layers: [group], activeLayerId: child.id };
    });
    f.owner.begin(7, childId!, { x: 0, y: 0 }, f.scope);
    f.owner.update(7, { x: 10, y: 20 }); f.owner.finish(7, true);
    expect(findDocumentLayer(f.document, childId!)?.transform).toMatchObject({ tx: 10, ty: -5 });
  });
  it('rejects position locks and singular parents before mutation admission', () => {
    const locked = fixture(d => ({ ...d, layers: d.layers.map(layer => ({ ...layer, locks: { ...layer.locks, position: true } })) }));
    expect(locked.owner.begin(7, locked.before.activeLayerId!, { x: 0, y: 0 }, locked.scope)).toBe(false);
    const singular = fixture(d => ({ ...d, layers: [{ ...createGroupLayer('Singular'), children: d.layers,
      transform: { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 } }] }));
    expect(singular.owner.begin(7, singular.before.activeLayerId!, { x: 0, y: 0 }, singular.scope)).toBe(false);
    expect(singular.mutations.active).toBe(false);
  });
});
