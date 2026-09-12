import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import { useAdjustmentCreationIntents } from './useAdjustmentCreationIntents';
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], setup: null as null | (() => () => void) }));
vi.mock('react', () => ({ useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (factory: () => unknown) => hooks.slots[hooks.cursor++] ??= factory(),
  useLayoutEffect: (setup: () => () => void) => { hooks.setup = setup; } }));
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.setup = null; });
const sessions: DocumentSession[] = [];
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
it('does not dispatch retained unmounted callbacks and suppresses an old rejected intent after StrictMode reconnect', async () => {
  const session = new DocumentSession({ id: 'A' as DocumentSessionId, source: { id: 'A', name: 'A', mediaType: 'image/png' } });
  session.setDocument(createImageDocument('A', 100, 50, 'asset')); session.setReady(); sessions.push(session);
  const renderer = {}; let resolve!: (value: { status: string; message?: string }) => void;
  const pending = new Promise<{ status: string; message?: string }>(done => { resolve = done; });
  const ports = { getSession: () => session, getRenderer: () => renderer, getProjectedDocument: () => session.getSnapshot().document,
    captureScope: () => ({ isCurrent: () => true }), properties: { show: vi.fn() },
    execute: vi.fn(() => pending), reportFailure: vi.fn() };
  const render = () => { hooks.cursor = 0; return useAdjustmentCreationIntents(ports); };
  const owner = render(); expect(await owner.standalone('curves')).toBe(false); expect(ports.execute).not.toHaveBeenCalled();
  const cleanup = hooks.setup!(), old = owner.standalone('curves'); cleanup();
  expect(render()).toBe(owner); hooks.setup!(); resolve({ status: 'rejected', message: 'Old failure' });
  expect(await old).toBe(false); expect(ports.reportFailure).not.toHaveBeenCalled();
  ports.execute.mockResolvedValue({ status: 'completed' });
  expect(await owner.standalone('curves')).toBe(true); expect(ports.execute).toHaveBeenCalledTimes(2);
});
