import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDeleteTargetIntent } from './useDeleteTargetIntent';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import type { DeleteTargetIntentPorts } from '../../application/input/DeleteTargetIntent';
import { createImageDocument } from '../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], setup: null as (() => void | (() => void)) | null }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (factory: () => unknown) => hooks.slots[hooks.cursor++] ??= factory(),
  useLayoutEffect: (setup: () => void | (() => void)) => { hooks.setup = setup; }
}));
const sessions: DocumentSession[] = [];
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.setup = null; });
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
const fixture = () => {
  const session = new DocumentSession({ id: 'A' as DocumentSessionId, source: { id: 'A', name: 'A', mediaType: 'image/png' } });
  sessions.push(session); session.setDocument(createImageDocument('A', 8, 6, 'asset')); session.setReady();
  session.updateEditor(editor => ({ ...editor, selectionMaskSnapshot: SelectionMaskSnapshot.fromRaw(8, 6, new Uint16Array(48)) }));
  const renderer = {}, actions: Array<() => unknown> = [];
  const ports: Omit<DeleteTargetIntentPorts, 'isMounted'> = {
    getSession: () => session, getRenderer: () => renderer, getProjectedDocument: () => session.getSnapshot().document,
    captureScope: () => ({ isCurrent: () => true }), getTool: () => 'brush', getSelectedLayerIds: () => [],
    vector: { deleteSelection: vi.fn(() => true) }, fill: { clearSelection: vi.fn(() => true) },
    admission: { runAfter: action => { actions.push(action); } }, transform: { isActive: () => false, cancel: vi.fn() },
    deleteLayers: vi.fn(), reportFailure: vi.fn()
  };
  const render = (overrides: Partial<typeof ports> = {}) => { hooks.cursor = 0; return useDeleteTargetIntent({ ...ports, ...overrides }); };
  return { session, actions, ports, render };
};

it('retains ordinary-rerender work and the captured fill callback while reading current canonical state', () => {
  const f = fixture(), owner = f.render(); hooks.setup!(); owner.run();
  const originalFill = f.ports.fill.clearSelection;
  const nextFill = vi.fn(() => true);
  expect(f.render({ fill: { clearSelection: nextFill } })).toBe(owner); f.actions[0]!();
  expect(originalFill).toHaveBeenCalledExactlyOnceWith({ layerId: f.session.getSnapshot().document!.activeLayerId, channel: 'pixels' });
  expect(nextFill).not.toHaveBeenCalled();
  owner.run(); f.actions[1]!(); expect(nextFill).toHaveBeenCalledOnce();
});

it('StrictMode reconnect admits fresh work without reviving the earlier pending action', () => {
  const f = fixture(), owner = f.render(); owner.run(); expect(f.actions).toHaveLength(0);
  const cleanup = hooks.setup!(); owner.run(); cleanup?.();
  expect(f.render()).toBe(owner); hooks.setup!(); f.actions[0]!();
  expect(f.ports.fill.clearSelection).not.toHaveBeenCalled();
  owner.run(); f.actions[1]!(); expect(f.ports.fill.clearSelection).toHaveBeenCalledOnce();
});

it('retained callbacks and already-pending work are inert after unmount without successor error', () => {
  const f = fixture(), owner = f.render(), cleanup = hooks.setup!(); owner.run(); cleanup?.();
  f.actions[0]!(); owner.run();
  expect(f.actions).toHaveLength(1); expect(f.ports.fill.clearSelection).not.toHaveBeenCalled();
  expect(f.ports.reportFailure).not.toHaveBeenCalled();
});
