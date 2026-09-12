import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultTextLayerData } from '@lighttable/text-core';
import { createAnchor, createSubpath, createVectorPath, identityAffineMatrix } from '@lighttable/vector-core';
import { realizePathArcLength } from '@lighttable/vector-rendering';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { createDocumentMutationController } from '../../application/documents/useDocumentMutationController';
import { captureInteractionScope } from '../../application/interactions/captureInteractionScope';
import { createImageDocument, createTextLayerNode, type ImageDocument } from '../../editor/document/documentTypes';
import { setFlowTextLayout } from '../../editor/document/textLayerCommands';
import type { TextLayerEditingLayout } from '../../text/rendering/TextLayerRenderCoordinator';
import { useTextGeometryGestures } from './useTextGeometryGestures';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as any[], pending: [] as (() => void)[] }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (create: () => unknown) => hooks.slots[hooks.cursor++] ??= create(),
  useLayoutEffect: (setup: () => (() => void) | void, deps: unknown[]) => {
    const index = hooks.cursor++, previous = hooks.slots[index];
    if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
      hooks.pending.push(() => { previous?.cleanup?.(); hooks.slots[index] = { deps, cleanup: setup() }; });
    }
  }
}));
const sessions: DocumentSession[] = [];
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.pending = []; });
afterEach(() => { sessions.splice(0).forEach(session => session.dispose()); });
const flushLayout = () => hooks.pending.splice(0).forEach(run => run());
const unmount = () => hooks.slots.forEach(slot => slot?.cleanup?.());
type Kind = 'move' | 'frame' | 'path';
const kinds: Kind[] = ['move', 'frame', 'path'];

const fixture = (kind: Kind) => {
  const layer = createTextLayerNode(createDefaultTextLayerData());
  let document: ImageDocument = { ...createImageDocument('Text', 400, 300, 'source'), layers: [layer], activeLayerId: layer.id };
  document = setFlowTextLayout(document, layer.id, kind === 'path' ? {
    mode: 'path', pathLayerId: 'vector', pathElementId: 'path', pathSubpathId: 'line',
    startOffset: 10, endOffset: 90, direction: 'forward', side: 'left', upright: false
  } : { mode: 'paragraph', frame: { x: 10, y: 20, width: 100, height: 60 }, overflow: 'visible', writingMode: 'horizontal-tb' });
  const makeSession = () => {
    const value = new DocumentSession({ id: 'same-session-id' as DocumentSessionId,
      source: { id: 'source', name: 'Text', mediaType: 'image/png' } });
    value.setDocument(document); value.setReady(); sessions.push(value); return value;
  };
  const session = makeSession(); let currentSession = session, lifecycle = {}, generation = 1;
  let editingLayerId: string | null = layer.id, projectedId: string | null = document.id;
  let editingDocumentId = document.id;
  const table = realizePathArcLength(createVectorPath('path', 'Line', [createSubpath('line', [
    createAnchor('a', { x: 0, y: 0 }), createAnchor('b', { x: 100, y: 0 })
  ])]), 'line', identityAffineMatrix(), 0.25);
  const layout: TextLayerEditingLayout = { layerId: layer.id, preparationKey: 'geometry-fixture',
    sourceText: '', writingMode: 'horizontal-tb', localToDocument: identityAffineMatrix(),
    layout: { schemaVersion: 2, key: 'geometry-fixture', glyphRuns: [], lines: [], selectionGeometry: [],
      clusterMap: [], warnings: [], caretStops: [], inkBounds: { x: 0, y: 0, width: 0, height: 0 },
      logicalBounds: { x: 0, y: 0, width: 0, height: 0 } },
    path: { table, pathLayout: { mode: 'path', pathLayerId: 'vector', pathElementId: 'path', pathSubpathId: 'line',
      startOffset: 10, endOffset: 90, direction: 'forward', side: 'left', upright: false },
    projection: { glyphRuns: [], linearOrigin: 0, contentAdvance: 20,
      range: { start: 10, end: 90, origin: 10, available: 80, overflow: 0, direction: 'forward' } }
  } };
  let renderer = { currentTextEditingLayout: vi.fn<() => TextLayerEditingLayout | null>(() => layout) };
  let preview: ImageDocument | null = null, onPreview = () => {}, onApply = () => {}, historyId = 0;
  const order: string[] = [];
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => currentSession.getSnapshot().document,
    previewSnapshot: next => { preview = next; onPreview(); },
    discardPreview: () => { preview = null; order.push('geometry'); },
    applySnapshot: next => { currentSession.setDocument(next); onApply(); },
    pushHistoryEntry: entry => currentSession.history.record({ ...entry,
      id: `geometry-${++historyId}`, documentId: currentSession.id, type: entry.type ?? 'text.geometry', label: entry.label ?? 'Text geometry' }),
    isMutationBlocked: () => !currentSession.isAcceptingMutations()
  }));
  const ports: Parameters<typeof useTextGeometryGestures>[1] = {
    getSession: () => currentSession, getRenderer: () => renderer, getProjectedDocumentId: () => projectedId,
    editing: { getSnapshot: () => ({ status: 'editing', documentId: editingDocumentId, layerId: editingLayerId }) } as never,
    documentMutations: mutations,
    captureScope: () => captureInteractionScope({ getWorkspaceId: () => currentSession.id,
      getLifecycleIdentity: () => lifecycle, getRenderer: () => renderer, getRendererGeneration: () => generation })
  };
  let documentIdentity = 'tab';
  const render = (commit = true) => {
    hooks.cursor = 0;
    const result = useTextGeometryGestures({ documentIdentity, session: currentSession, renderer, lifecycle, generation }, { ...ports });
    if (commit) flushLayout(); return result;
  };
  const beginPoint = kind === 'move' ? { x: 0, y: 0 } : kind === 'frame' ? { x: 110, y: 80 } : { x: 10, y: 0 };
  const finalPoint = kind === 'move' ? { x: 30, y: 20 } : kind === 'frame' ? { x: 140, y: 100 } : { x: 40, y: 0 };
  return { session, ports, render, order, mutations, document, beginPoint, finalPoint, makeSession,
    preview: () => preview, reads: () => renderer.currentTextEditingLayout.mock.calls.length,
    setPreviewEffect: (effect: () => void) => { onPreview = effect; }, setApplyEffect: (effect: () => void) => { onApply = effect; },
    retire: (reason: string) => {
      if (reason === 'renderer') renderer = { currentTextEditingLayout: vi.fn(() => layout) };
      if (reason === 'lifecycle') lifecycle = {};
      if (reason === 'generation') generation++;
      if (reason === 'session') currentSession = makeSession();
      if (reason === 'disposed') session.dispose();
      if (reason === 'editing') editingLayerId = 'another-text-layer';
      if (reason === 'editing-document') editingDocumentId = 'another-document' as typeof editingDocumentId;
      if (reason === 'document-identity') documentIdentity = 'other-tab';
      if (reason === 'editing-owner') Object.assign(ports, { editing: { ...ports.editing } });
      if (reason === 'mutation-owner') Object.assign(ports, { documentMutations: { begin: mutations.begin } });
      if (reason === 'mixed') projectedId = 'another-document';
      if (reason === 'document') { currentSession = makeSession(); documentIdentity = 'other-tab'; }
    },
    unavailable: () => renderer.currentTextEditingLayout.mockReturnValue(null)
  };
};

describe('text geometry composition (simulated hooks; actual session, mutation and history owners)', () => {
  it.each(kinds)('%s survives ordinary rerender and its own previews, commits once and replays exactly', async kind => {
    const f = fixture(kind), owners = f.render(), gesture = owners[kind];
    expect(gesture.begin(7, f.beginPoint, 5)).toBe(true);
    const reads = f.reads();
    expect(gesture.move(7, f.finalPoint)).toBe(true); expect(f.session.getSnapshot().document).toBe(f.document);
    expect(f.render()).toBe(owners); expect(f.preview()).not.toBeNull();
    expect(gesture.finish(7, f.finalPoint)).toBe(true); expect(f.reads()).toBe(reads);
    const committed = f.session.getSnapshot().document;
    expect(committed).not.toBe(f.document); expect(f.session.history.getSnapshot().undoDepth).toBe(1);
    await f.session.history.undo(); expect(f.session.getSnapshot().document).toBe(f.document);
    await f.session.history.redo(); expect(f.session.getSnapshot().document).toBe(committed);
  });
  it.each(kinds.flatMap(kind => ['renderer', 'lifecycle', 'generation', 'session', 'disposed', 'editing', 'mixed'].map(reason => [kind, reason] as const)))
  ('%s rejects %s retirement before the next sample without requiring a React effect', (kind, reason) => {
    const f = fixture(kind), gesture = f.render()[kind];
    expect(gesture.begin(7, f.beginPoint, 5)).toBe(true); expect(gesture.move(7, f.finalPoint)).toBe(true);
    f.retire(reason); expect(gesture.finish(7, f.finalPoint)).toBe(false);
    expect(f.session.getSnapshot().document).toBe(f.document); expect(f.session.history.getSnapshot().undoDepth).toBe(0);
  });
  it.each(kinds)('%s rejects retirement synchronously caused by its final preview before commit', kind => {
    const f = fixture(kind), gesture = f.render()[kind];
    expect(gesture.begin(7, f.beginPoint, 5)).toBe(true);
    f.setPreviewEffect(() => f.retire('lifecycle'));
    expect(gesture.finish(7, f.finalPoint)).toBe(false); expect(f.session.history.getSnapshot().undoDepth).toBe(0);
  });
  it.each(kinds)('%s preserves a committed result when its own publication retires presentation', kind => {
    const f = fixture(kind), gesture = f.render()[kind];
    expect(gesture.begin(7, f.beginPoint, 5)).toBe(true);
    f.setApplyEffect(() => f.retire('lifecycle'));
    expect(gesture.finish(7, f.finalPoint)).toBe(true); expect(f.session.history.getSnapshot().undoDepth).toBe(1);
  });
  it.each(['frame', 'path'] as const)('%s rejects unavailable realization without starting a transaction', kind => {
    const f = fixture(kind), gesture = f.render()[kind]; f.unavailable();
    expect(gesture.begin(7, f.beginPoint, 5)).toBe(false); expect(f.mutations.active).toBe(false);
  });
  it.each(kinds)('%s cancels in layout before later document Properties/editing reset; runtime-only retirement adds no reset', kind => {
    const f = fixture(kind), gesture = f.render()[kind];
    expect(gesture.begin(7, f.beginPoint, 5)).toBe(true); gesture.move(7, f.finalPoint);
    f.retire('lifecycle'); f.render(); expect(f.order).toEqual(['geometry']);
    expect(gesture.begin(8, f.beginPoint, 5)).toBe(true); gesture.move(8, f.finalPoint);
    f.retire('document'); f.render(false);
    hooks.pending.push(() => { f.order.push('properties', 'editing'); }); flushLayout();
    expect(f.order).toEqual(['geometry', 'geometry', 'properties', 'editing']);
  });
  it.each(kinds)('%s cancels on unmount/StrictMode cleanup and admits fresh work after reconnect', kind => {
    const f = fixture(kind), gesture = f.render()[kind];
    expect(gesture.begin(7, f.beginPoint, 5)).toBe(true); gesture.move(7, f.finalPoint);
    unmount(); expect(gesture.owns(7)).toBe(false); expect(f.preview()).toBeNull();
    expect(gesture.begin(8, f.beginPoint, 5)).toBe(false);
    // StrictMode replays the same layout setup while retaining controller/ref instances.
    hooks.slots.forEach((slot, i) => { if (slot?.deps) hooks.slots[i] = undefined; });
    expect(f.render()[kind]).toBe(gesture); expect(gesture.begin(9, f.beginPoint, 5)).toBe(true);
    expect(gesture.finish(7, f.finalPoint)).toBe(false); expect(gesture.finish(9, f.finalPoint)).toBe(true);
  });
  it('rejects a render-to-layout renderer replacement and does not resolve layout on the successor', () => {
    const f = fixture('frame'), gesture = f.render(false).frame;
    f.retire('renderer'); flushLayout();
    expect(gesture.begin(7, f.beginPoint, 5)).toBe(false); expect(f.reads()).toBe(0);
  });
  it.each(['editing-document', 'document-identity', 'editing-owner', 'mutation-owner'])
  ('rejects %s mismatch immediately, including before the replacement layout effect', reason => {
    const f = fixture('move'), gesture = f.render().move;
    expect(gesture.begin(7, f.beginPoint)).toBe(true);
    f.retire(reason); f.render(false);
    expect(gesture.finish(7, f.finalPoint)).toBe(false); expect(f.session.history.getSnapshot().undoDepth).toBe(0);
  });
});
