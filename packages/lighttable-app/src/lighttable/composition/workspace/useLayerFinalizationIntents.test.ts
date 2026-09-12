import { beforeEach, expect, it, vi } from 'vitest';
import { useLayerFinalizationIntents } from './useLayerFinalizationIntents';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';
const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], setup: null as (() => void | (() => void)) | null }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (factory: () => unknown) => hooks.slots[hooks.cursor++] ??= factory(),
  useLayoutEffect: (setup: () => void | (() => void)) => { hooks.setup = setup; }
}));
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.setup = null; });
it('StrictMode reconnect allows new work without reviving an old awaiting admission', async () => {
  const session = new DocumentSession({ id: 'A' as DocumentSessionId, source: { id: 'A', name: 'A', mediaType: 'image/png' } });
  session.setDocument(createImageDocument('A', 100, 100, 'asset')); session.setReady(); const renderer = {};
  let resolve!: (value: { status: 'admitted' }) => void;
  const pending = new Promise<{ status: 'admitted' }>(done => { resolve = done; });
  const execute = vi.fn(async () => ({ status: 'completed' })), finishText = vi.fn(() => true);
  const ports = { getSession: () => session, getRenderer: () => renderer, getProjectedDocument: () => session.getSnapshot().document,
    captureScope: () => ({ isCurrent: () => true }), getSelectedLayerIds: () => [], text: { finishBeforeTransition: finishText },
    creation: { cancelPoint: vi.fn(), cancelParagraph: vi.fn() },
    requestAdmission: vi.fn(async () => pending), execute, reportFailure: vi.fn() };
  const render = () => { hooks.cursor = 0; return useLayerFinalizationIntents(ports); };
  const owner = render(); expect(await owner.flattenImage()).toBe(false); expect(finishText).not.toHaveBeenCalled();
  const cleanup = hooks.setup!(); const old = owner.flattenImage(); cleanup?.();
  expect(render()).toBe(owner); hooks.setup!(); resolve({ status: 'admitted' });
  expect(await old).toBe(false); expect(execute).not.toHaveBeenCalled();
  expect(await owner.flattenImage()).toBe(true); expect(execute).toHaveBeenCalledOnce();
});
