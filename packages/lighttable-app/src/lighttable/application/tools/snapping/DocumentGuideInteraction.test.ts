import { expect, it, vi } from 'vitest';
import { DocumentGuideInteraction } from './DocumentGuideInteraction';
import type { DocumentGuideLease } from './DocumentGuideInteraction';
import { createImageDocument } from '../../../editor/document/documentTypes';
import { createDocumentMutationController, type DocumentMutationHistoryEntry } from '../../documents/useDocumentMutationController';
const sample = (x = 30, y = 60, altKey = false, shiftKey = false) => ({ x, y, altKey, shiftKey, scale: 1 });
const fixture = () => {
  let document = createImageDocument('Guides', 200, 100, 'asset'), current = true;
  document.guides = [{ id: 'a', orientation: 'vertical', position: 10 }, { id: 'b', orientation: 'horizontal', position: 20 }];
  const history: typeof document[] = [], reportFailure = vi.fn();
  const changeDocument = vi.fn((mutate: (value: typeof document) => typeof document) => {
    const next = mutate(document); if (next === document) return false;
    history.push(document); document = next; owner.synchronize(); return true;
  });
  const owner = new DocumentGuideInteraction({ capture: () => ({ isCurrent: () => current, getDocument: () => document }), changeDocument, reportFailure });
  return { owner, history, reportFailure, changeDocument, document: () => document,
    replace: (change: Partial<typeof document>) => { document = { ...document, ...change }; owner.synchronize(); },
    retire: () => { current = false; owner.synchronize(); } };
};
it('publishes only cached draft during movement and consumes final pointer-up coordinates/modifiers in one ordered commit', () => {
  const f = fixture(), opening = f.document(), lease = f.owner.beginExisting('a')!;
  lease.move(sample()); const draft = f.owner.getSnapshot(); expect(f.owner.getSnapshot()).toBe(draft);
  expect(f.document()).toBe(opening); expect(f.history).toHaveLength(0);
  lease.finish(sample(99, 75, true), true);
  expect(f.document().guides).toEqual([{ id: 'a', orientation: 'horizontal', position: 75 }, opening.guides[1]]);
  expect(f.history).toHaveLength(1); expect(f.owner.getSnapshot()).toBeNull();
});
it('leaves an untouched existing guide a true no-op with stable ordering', () => {
  const f = fixture(), opening = f.document(); f.owner.beginExisting('a')!.finish(sample(10), true);
  expect(f.document()).toBe(opening); expect(f.changeDocument).not.toHaveBeenCalled();
});
it('creates using final sample even with no move and removes only the dragged existing guide outside', () => {
  const f = fixture(); f.owner.beginNew('horizontal')!.finish(sample(30, 44), true);
  expect(f.document().guides[2].position).toBe(44);
  f.owner.beginExisting('a')!.finish(sample(-1), false);
  expect(f.document().guides.map(g => g.id)).toEqual(['b', f.document().guides[1].id]); expect(f.history).toHaveLength(2);
});
it('drops a new guide outside without history and supports cancel without publication', () => {
  const f = fixture(); f.owner.beginNew('vertical')!.finish(sample(-1), false);
  const lease = f.owner.beginExisting('a')!; lease.move(sample()); lease.cancel();
  expect(f.history).toHaveLength(0); expect(f.owner.getSnapshot()).toBeNull();
});
it.each(['runtime', 'guides', 'width', 'height'] as const)('retires %s without writing the successor', kind => {
  const f = fixture(), lease = f.owner.beginExisting('a')!; lease.move(sample());
  if (kind === 'runtime') f.retire(); else if (kind === 'guides') f.replace({ guides: [...f.document().guides] });
  else f.replace({ [kind]: 500 });
  expect(lease.isCurrent()).toBe(false); expect(f.owner.getSnapshot()).toBeNull(); lease.finish(sample(), true);
  expect(f.history).toHaveLength(0);
});
it('preserves same-session unrelated edits while completing guides', () => {
  const f = fixture(), lease = f.owner.beginExisting('a')!;
  f.replace({ name: 'New name', revision: 99 }); lease.finish(sample(), true);
  expect(f.document().name).toBe('New name'); expect(f.document().revision).toBe(100);
});
it('menu clear retires the draft first and late terminal cannot restore it', () => {
  const f = fixture(), lease = f.owner.beginExisting('a')!; lease.move(sample()); f.owner.clear(); lease.finish(sample(), true);
  expect(f.document().guides).toEqual([]); expect(f.history).toHaveLength(1);
});
it('reports blocked admission even when the mutation callback was never called', () => {
  const f = fixture(); f.changeDocument.mockReturnValue(false); f.owner.beginExisting('a')!.finish(sample(), true);
  expect(f.reportFailure).toHaveBeenCalledWith('The guide edit could not be committed.'); expect(f.owner.getSnapshot()).toBeNull();
});
it('retains the final draft through synchronous canonical publication then clears it', () => {
  const f = fixture(), lease = f.owner.beginExisting('a')!; lease.move(sample());
  const reads: unknown[] = []; f.owner.subscribe(() => reads.push(f.document().guides));
  lease.finish(sample(), true); expect(reads).toEqual([f.document().guides]);
});
it('suppresses identical resolved samples rather than rebuilding and publishing ruler-quantized drafts', () => {
  const f = fixture(), notify = vi.fn(), lease = f.owner.beginExisting('a')!; f.owner.subscribe(notify);
  lease.move(sample(30, 60, false, true)); const draft = f.owner.getSnapshot();
  lease.move(sample(30, 80, false, true));
  expect(f.owner.getSnapshot()).toBe(draft); expect(notify).toHaveBeenCalledOnce();
});
it.each([false, true])('uses actual document mutation history and reports a rejected history after publication (reject=%s)', reject => {
  let document = createImageDocument('Guide', 200, 100, 'asset');
  document.guides = [{ id: 'a', orientation: 'vertical', position: 10 }];
  const entries: DocumentMutationHistoryEntry[] = [], reportFailure = vi.fn();
  const controller = createDocumentMutationController(() => ({ getDocument: () => document,
    applySnapshot: next => { document = next; },
    previewSnapshot: vi.fn(), discardPreview: vi.fn(), pushHistoryEntry: entry => {
      if (reject) throw new Error('Guide history rejected.'); entries.push(entry);
    }
  }));
  const owner = new DocumentGuideInteraction({ capture: () => ({ isCurrent: () => true, getDocument: () => document }),
    changeDocument: controller.change, reportFailure });
  owner.beginExisting('a')!.finish(sample(), true);
  if (reject) {
    expect(reportFailure).toHaveBeenCalledWith('Guide history rejected.'); expect(document.guides[0].position).toBe(10);
    expect(entries).toHaveLength(0);
  } else {
    expect(reportFailure).not.toHaveBeenCalled(); expect(entries).toHaveLength(1); expect(document.guides[0].position).toBe(30);
    entries[0].undo(); expect(document.guides[0].position).toBe(10); entries[0].redo(); expect(document.guides[0].position).toBe(30);
  }
});
it('keeps a same-runtime publication failure visible when canonical guide identity already changed', () => {
  const f = fixture(); f.changeDocument.mockImplementation(mutate => {
    f.replace(mutate(f.document())); throw new Error('Late publication failure.');
  });
  f.owner.beginExisting('a')!.finish(sample(), true);
  expect(f.reportFailure).toHaveBeenCalledWith('Late publication failure.');
});
it('never clears a successor preview started by synchronous canonical publication', () => {
  const f = fixture(); let successor: DocumentGuideLease | null = null;
  f.changeDocument.mockImplementation(mutate => {
    f.replace(mutate(f.document())); successor = f.owner.beginExisting('b')!; successor.move(sample(50, 80)); return true;
  });
  const opening = f.owner.beginExisting('a')!; opening.move(sample()); opening.finish(sample(), true);
  expect((successor as DocumentGuideLease | null)?.isCurrent()).toBe(true);
  expect(f.owner.getSnapshot()?.find(guide => guide.id === 'b')?.position).toBe(80);
  opening.cancel(); expect(f.owner.getSnapshot()).not.toBeNull();
});
