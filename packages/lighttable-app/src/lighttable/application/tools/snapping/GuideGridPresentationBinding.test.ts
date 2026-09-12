import { expect, it, vi } from 'vitest';
import type { DocumentGuide } from '../../../editor/document/documentTypes';
import { GuideGridPresentationBinding, type GuideGridPresentationInputs } from './GuideGridPresentationBinding';

const fixture = () => {
  let current = true, draft: readonly DocumentGuide[] | null = null;
  const listeners = new Set<() => void>();
  const renderer = { setDocumentGuideEditingFrame: vi.fn(), setDocumentGridEditingFrame: vi.fn() };
  let inputs: GuideGridPresentationInputs = { document: { width: 100, height: 80,
    guides: [{ id: 'a', orientation: 'vertical', position: 20 }] },
    guidesVisible: true, gridVisible: true, gridSpacing: 10, gridOriginX: 0, gridOriginY: 0, zoom: 1 };
  const source = { getSnapshot: () => draft,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const create = () => new GuideGridPresentationBinding(renderer, () => current, () => inputs, source);
  return { renderer, create, source, listeners, input: () => inputs,
    change: (patch: Partial<GuideGridPresentationInputs>) => { inputs = { ...inputs, ...patch }; },
    retire: () => { current = false; },
    draft: (next: readonly DocumentGuide[] | null) => { draft = next; listeners.forEach(listener => listener()); } };
};
it('publishes guide drafts directly without rebuilding the grid or requiring React', () => {
  const f = fixture(), binding = f.create(); binding.mount();
  const grid = f.renderer.setDocumentGridEditingFrame.mock.calls[0][0];
  for (let position = 21; position < 40; position++) f.draft([{ id: 'a', orientation: 'vertical', position }]);
  expect(f.renderer.setDocumentGuideEditingFrame).toHaveBeenCalledTimes(20);
  expect(f.renderer.setDocumentGridEditingFrame).toHaveBeenCalledOnce();
  expect(grid.edges.length).toBeGreaterThan(0);
  expect(f.renderer.setDocumentGuideEditingFrame.mock.lastCall![0].edges[0].start.x).toBe(39);
});
it('deduplicates unchanged frames across unrelated document/chrome updates', () => {
  const f = fixture(), binding = f.create(); binding.mount();
  f.change({ document: { ...f.input().document! } }); binding.present();
  binding.present();
  expect(f.renderer.setDocumentGuideEditingFrame).toHaveBeenCalledOnce();
  expect(f.renderer.setDocumentGridEditingFrame).toHaveBeenCalledOnce();
  f.change({ zoom: 2 }); binding.present();
  expect(f.renderer.setDocumentGuideEditingFrame).toHaveBeenCalledOnce();
  expect(f.renderer.setDocumentGridEditingFrame).toHaveBeenCalledTimes(2);
});
it('clears the draft to live canonical guides without flashing old React data', () => {
  const f = fixture(), binding = f.create(); binding.mount();
  const committed: readonly DocumentGuide[] = [{ id: 'a', orientation: 'vertical', position: 55 }];
  f.draft(committed);
  f.change({ document: { ...f.input().document!, guides: committed } });
  f.draft(null);
  expect(f.renderer.setDocumentGuideEditingFrame.mock.lastCall![0].edges[0].start.x).toBe(55);
  expect(f.renderer.setDocumentGuideEditingFrame).toHaveBeenCalledTimes(2);
});
it('old cleanup and draft events cannot clear or overwrite a successor using the same renderer', () => {
  const f = fixture(), old = f.create(); old.mount();
  const successor = f.create(); successor.mount();
  const guideWrites = f.renderer.setDocumentGuideEditingFrame.mock.calls.length;
  old.unmount(); expect(f.renderer.setDocumentGuideEditingFrame).toHaveBeenCalledTimes(guideWrites);
  f.draft([{ id: 'a', orientation: 'vertical', position: 60 }]);
  expect(f.renderer.setDocumentGuideEditingFrame).toHaveBeenCalledTimes(guideWrites + 1);
  successor.unmount();
  expect(f.renderer.setDocumentGuideEditingFrame.mock.lastCall![0]).toBeNull();
  expect(f.renderer.setDocumentGridEditingFrame.mock.lastCall![0]).toBeNull();
  expect(f.listeners.size).toBe(0);
});
it('does not write after renderer retirement, including cleanup; reconnect obtains fresh frames', () => {
  const f = fixture(), binding = f.create(); binding.mount(); f.retire();
  f.draft([]); binding.present(); binding.unmount();
  expect(f.renderer.setDocumentGuideEditingFrame).toHaveBeenCalledOnce();
  expect(f.renderer.setDocumentGridEditingFrame).toHaveBeenCalledOnce();
  expect(f.listeners.size).toBe(0);
});
it('clears hidden slots and reuses existing exact grid coarsening geometry', () => {
  const f = fixture(), binding = f.create(); binding.mount();
  f.change({ gridVisible: false, guidesVisible: false }); binding.present();
  expect(f.renderer.setDocumentGridEditingFrame.mock.lastCall![0]).toBeNull();
  expect(f.renderer.setDocumentGuideEditingFrame.mock.lastCall![0]).toBeNull();
  f.change({ document: null }); binding.present();
  expect(f.renderer.setDocumentGuideEditingFrame.mock.lastCall![0]).toBeNull();
});
it('supports mount-cleanup-mount without retaining stale frame caches or subscriptions', () => {
  const f = fixture(), binding = f.create(); binding.mount(); binding.unmount(); binding.mount();
  expect(f.listeners.size).toBe(1);
  expect(f.renderer.setDocumentGuideEditingFrame.mock.lastCall![0]).not.toBeNull();
});
