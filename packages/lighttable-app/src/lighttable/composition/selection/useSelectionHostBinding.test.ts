import { beforeEach, expect, it, vi } from 'vitest';
import { createEditorSession } from '../../editor/session/editorSession';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';
import { DocumentSelectionStateStore } from '../../application/tools/selection/DocumentSelectionStateStore';
import { resolveDeleteTarget } from '../../application/input/resolveDeleteTarget';
import { useSelectionHostBinding } from './useSelectionHostBinding';

const hooks = vi.hoisted(() => ({ setup: null as null | (() => () => void),
  ref: null as null | { current: unknown },
  memo: null as null | { dependencies: readonly unknown[]; value: unknown } }));
vi.mock('react', () => ({ useRef: (current: unknown) => hooks.ref ??= { current },
  useMemo: (create: () => unknown, dependencies: readonly unknown[]) => {
    if (!hooks.memo || dependencies.some((value, index) => value !== hooks.memo!.dependencies[index])) {
      hooks.memo = { dependencies, value: create() };
    }
    return hooks.memo.value;
  }, useLayoutEffect: (setup: () => () => void) => { hooks.setup = setup; } }));
beforeEach(() => { hooks.setup = null; hooks.ref = null; hooks.memo = null; });

it.each(['paint-only', 'fully-clipped', 'inactive'] as const)(
  'routes Delete from canonical %s coverage, never provenance or measured nonzero support', (kind) => {
    const session = new DocumentSession({ id: 'delete-document' as DocumentSessionId,
      source: { id: 'source', name: 'image.png', mediaType: 'image/png' } });
    const document = createImageDocument('image.png', 4, 4, 'source');
    session.setDocument(document);
    const store = new DocumentSelectionStateStore(session);
    const lease = store.acquire(session.getSnapshot().documentRevision);
    const coverage = kind === 'inactive' ? SelectionMaskSnapshot.inactive(4, 4)
      : SelectionMaskSnapshot.fromRaw(4, 4, new Uint16Array(16).fill(kind === 'paint-only' ? 0x3c00 : 0));
    expect(store.compareAndSwap(lease.selection.revision, { ...lease.selection,
      revision: (Number(lease.selection.revision) + 1) as typeof lease.selection.revision,
      active: coverage.active, coverage, supportBounds: coverage.measureSupportBounds(), provenance: []
    })).toBe(true);
    const binding = useSelectionHostBinding(session, {}, 1, {}, () => ({ isCurrent: () => true }),
      { recordObservedCommand: vi.fn() },
      () => ({ document, editor: createEditorSession(), selectedLayerIds: [], scale: 1 }),
      { updateEditor: vi.fn(), draft: vi.fn(), snapFeedback: vi.fn() });
    const cleanup = hooks.setup!();
    expect(session.getSnapshot().editor.selection).toEqual([]);
    expect(resolveDeleteTarget({ activeTool: 'brush', hasVectorSelection: false,
      hasPixelSelection: binding.hasActiveSelection(), hasActiveLayer: true }))
      .toBe(kind === 'inactive' ? 'layers' : 'pixel-selection');
    cleanup();
    expect(() => binding.hasActiveSelection()).toThrow('selection is unavailable');
    session.dispose();
  });

it('rebinds null-to-ready renderer at the same generation and keeps normal render identity', () => {
  let renderer: object | null = null;
  let scale = 1;
  const session = { id: 'document', getSnapshot: () => ({ lifecycle: 'ready' }) } as DocumentSession;
  const lifecycle = {};
  const commands = { recordObservedCommand: vi.fn() };
  const projection = { updateEditor: vi.fn(), draft: vi.fn(), snapFeedback: vi.fn() };
  const capture = () => {
    const openingRenderer = renderer;
    return { isCurrent: () => renderer === openingRenderer };
  };
  const render = () => useSelectionHostBinding(session, renderer, 1, lifecycle, capture, commands,
    () => ({ document: null, editor: createEditorSession(), selectedLayerIds: [], scale }), projection);
  const opening = render();
  const cleanup = hooks.setup!();
  renderer = {};
  const ready = render();
  expect(ready).not.toBe(opening);
  cleanup(); hooks.setup!();
  opening.gesture.publishPointer(1);
  expect(projection.updateEditor).not.toHaveBeenCalled();
  ready.gesture.publishPointer(1);
  expect(projection.updateEditor).toHaveBeenCalledOnce();
  scale = 4;
  expect(render()).toBe(ready);
  expect(ready.gesture.getSnapContext({ x: 0, y: 0, width: 2, height: 2 }).zoom).toBe(4);
});

it('retires callbacks on same-ID session replacement and supports StrictMode layout replay', () => {
  let session = { id: 'same-id', getSnapshot: () => ({ lifecycle: 'ready' }) } as DocumentSession;
  const renderer = {}; const lifecycle = {};
  const capture = () => ({ isCurrent: () => true });
  const commands = { recordObservedCommand: vi.fn() };
  const projection = { updateEditor: vi.fn(), draft: vi.fn(), snapFeedback: vi.fn() };
  const render = () => useSelectionHostBinding(session, renderer, 1, lifecycle, capture, commands,
    () => ({ document: null, editor: createEditorSession(), selectedLayerIds: [], scale: 1 }), projection);
  const opening = render();
  const cleanup = hooks.setup!(); cleanup(); hooks.setup!();
  opening.gesture.publishDraft(null);
  expect(projection.draft).toHaveBeenCalledOnce();
  session = { id: 'same-id', getSnapshot: () => ({ lifecycle: 'ready' }) } as DocumentSession;
  const successor = render();
  opening.observation.shape({ mode: 'replace', shape: { kind: 'rectangle', points: [] }, featherRadius: 0, antiAlias: false });
  expect(commands.recordObservedCommand).not.toHaveBeenCalled();
  cleanup(); hooks.setup!();
  successor.observation.shape({ mode: 'replace', shape: { kind: 'rectangle', points: [] }, featherRadius: 0, antiAlias: false });
  expect(commands.recordObservedCommand).toHaveBeenCalledOnce();
});

it('rejects disposed-session callbacks before React layout cleanup and renderer detachment', () => {
  const session = new DocumentSession({ id: 'disposed-document' as DocumentSessionId,
    source: { id: 'source', name: 'image.png', mediaType: 'image/png' } });
  const document = createImageDocument('image.png', 4, 4, 'source');
  session.setDocument(document);
  const projection = { updateEditor: vi.fn(), draft: vi.fn(), snapFeedback: vi.fn() };
  const commands = { recordObservedCommand: vi.fn() };
  const binding = useSelectionHostBinding(session, {}, 1, {}, () => ({ isCurrent: () => true }), commands,
    () => ({ document, editor: createEditorSession(), selectedLayerIds: [], scale: 1 }), projection);
  hooks.setup!();
  session.dispose();
  binding.gesture.publishPointer(17);
  binding.gesture.publishDraft(null);
  binding.observation.shape({ mode: 'replace', shape: { kind: 'rectangle', points: [] }, featherRadius: 0, antiAlias: false });
  expect(projection.updateEditor).not.toHaveBeenCalled();
  expect(projection.draft).not.toHaveBeenCalled();
  expect(commands.recordObservedCommand).not.toHaveBeenCalled();
  expect(() => binding.hasActiveSelection()).toThrow('selection is unavailable');
});
