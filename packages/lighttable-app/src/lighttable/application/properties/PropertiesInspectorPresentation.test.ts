import { expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createRasterLayer } from '../../editor/document/documentCommands';
import { PropertiesInspectorPresentation } from './PropertiesInspectorPresentation';

const harness = () => {
  let current = true, frame = 0;
  const callbacks: (() => void)[] = [], reveal = vi.fn(), cancel = vi.fn();
  const owner = new PropertiesInspectorPresentation({ capture: () => ({ isCurrent: () => current, reveal }),
    schedule: callback => { callbacks.push(callback); return ++frame; }, cancel });
  owner.mount();
  return { owner, callbacks, reveal, cancel, retireContext: () => { current = false; } };
};
it('publishes live target synchronously and defers only panel reveal', () => {
  const h = harness(), changed = vi.fn(); h.owner.subscribe(changed);
  h.owner.show({ kind: 'document-processing', owner: 'grade' });
  expect(h.owner.targetRef.current).toEqual({ kind: 'document-processing', owner: 'grade' });
  expect(changed).toHaveBeenCalledOnce(); expect(h.reveal).not.toHaveBeenCalled();
  h.callbacks[0]!(); expect(h.reveal).toHaveBeenCalledOnce();
});
it('reserves async intent before completion and prevents older ticket/RAF stealing a newer target', () => {
  const h = harness(); const first = h.owner.beginIntent();
  h.owner.show({ kind: 'document-processing', owner: 'lens-fx' });
  first.show({ kind: 'document-processing', owner: 'grade' });
  expect(h.owner.getSnapshot()).toEqual({ kind: 'document-processing', owner: 'lens-fx' });
  const second = h.owner.beginIntent(); h.callbacks[0]!(); expect(h.reveal).not.toHaveBeenCalled();
  second.show({ kind: 'document-processing', owner: 'grade' }); h.callbacks[1]!();
  expect(h.reveal).toHaveBeenCalledOnce(); expect(h.cancel).toHaveBeenCalled();
});
it('retires even retained callbacks and permits StrictMode reconnect without reviving tickets', () => {
  const h = harness(), ticket = h.owner.beginIntent(); h.owner.retire(); h.owner.mount();
  ticket.show({ kind: 'document-processing', owner: 'grade' }); expect(h.callbacks).toHaveLength(0);
  h.owner.show({ kind: 'none' }); h.retireContext(); h.callbacks[0]!(); expect(h.reveal).not.toHaveBeenCalled();
});
it('uses existing reconciliation without invalidating tickets on unrelated document revisions', () => {
  const h = harness(); const document = createRasterLayer(createImageDocument('A', 20, 20, 'fixture'));
  h.owner.reconcile(document); const ticket = h.owner.beginIntent();
  h.owner.reconcile({ ...document, revision: document.revision + 1 }); expect(ticket.isCurrent()).toBe(true);
  h.owner.reconcile(createRasterLayer(document)); expect(ticket.isCurrent()).toBe(false);
});
it('equivalent target requests do not notify React but still supersede old intent', () => {
  const h = harness(), changed = vi.fn(); h.owner.subscribe(changed);
  h.owner.show({ kind: 'document-processing', owner: 'grade' }); const old = h.owner.beginIntent();
  h.owner.show({ kind: 'document-processing', owner: 'grade' });
  expect(changed).toHaveBeenCalledOnce(); expect(old.isCurrent()).toBe(false);
});
it('successful standalone creation publishes its new target before canonical reconciliation', () => {
  const h = harness(), before = createRasterLayer(createImageDocument('A', 20, 20, 'fixture'));
  h.owner.reconcile(before);
  const after = createRasterLayer(before);
  h.owner.show({ kind: 'layer', layerId: after.activeLayerId! });
  h.owner.reconcile(after); h.callbacks[0]!();
  expect(h.reveal).toHaveBeenCalledOnce();
  expect(h.owner.getSnapshot()).toEqual({ kind: 'layer', layerId: after.activeLayerId });
});
