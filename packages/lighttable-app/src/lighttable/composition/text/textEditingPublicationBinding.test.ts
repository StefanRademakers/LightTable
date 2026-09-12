import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultFlowTextSource, createDefaultTextLayerData } from '@lighttable/text-core';
import { WorkspaceSession } from '../../application/workspace/workspaceSession';
import { LightTableCommandService, LightTableCommandPortRegistry } from '../../application/commands/lightTableCommandService';
import { createDocumentMutationController } from '../../application/documents/useDocumentMutationController';
import type { DocumentSession } from '../../application/documents/documentSession';
import { captureInteractionScope } from '../../application/interactions/captureInteractionScope';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createTextLayer } from '../../editor/document/documentCommands';
import type { TextLayerEditingLayout } from '../../text/rendering/TextLayerRenderCoordinator';
import { useTextEditingPublication } from './useTextEditingPublication';
import { useTextSelectionGesture } from './useTextSelectionGesture';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as any[], pending: [] as (() => void)[] }));
vi.mock('react', () => ({
  useRef: (value: unknown) => hooks.slots[hooks.cursor++] ??= { current: value },
  useMemo: (create: () => unknown) => hooks.slots[hooks.cursor++] ??= create(),
  useLayoutEffect: (setup: () => (() => void), deps: unknown[]) => {
    const index = hooks.cursor++, previous = hooks.slots[index];
    if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
      hooks.pending.push(() => { previous?.cleanup?.(); hooks.slots[index] = { deps, cleanup: setup() }; });
    }
  }
}));
const disposers: (() => void)[] = [];
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.pending = []; });
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); });
const flushLayout = () => hooks.pending.splice(0).forEach(run => run());
const unmount = () => hooks.slots.forEach(slot => slot?.cleanup?.());
const fixture = () => {
  let id = 0, historyId = 0;
  const workspace = new WorkspaceSession({ createId: () => `session-${++id}` as never });
  const makeSession = () => {
    const opened = workspace.open({ source: { id: `source-${id}`, name: 'Text', mediaType: 'image/png' } });
    if (!opened.ok) throw new Error('Fixture could not open.');
    const session = opened.value;
    session.setDocument(createTextLayer(createImageDocument('Text', 100, 60, 'pixels'),
      { ...createDefaultTextLayerData(), source: createDefaultFlowTextSource('abcd') }, 'Text'));
    session.setReady(); return session;
  };
  const original = makeSession(), successor = makeSession(); workspace.activate(original.id);
  const service = new LightTableCommandService(workspace, new LightTableCommandPortRegistry());
  const laterService = new LightTableCommandService(workspace, new LightTableCommandPortRegistry());
  disposers.push(() => { service.dispose(); laterService.dispose(); workspace.dispose(); });
  let mounted = original, commands = service, lifecycle = {}, generation = 1;
  let onRecorded = () => {}, onPreview = () => {};
  const mutationsFor = (session: DocumentSession) => createDocumentMutationController(() => ({
    getDocument: () => session.getSnapshot().document, applySnapshot: next => session.setDocument(next),
    previewSnapshot: () => onPreview(), discardPreview: vi.fn(),
    pushHistoryEntry: entry => {
      session.history.record({ ...entry, id: `text-${++historyId}`, documentId: session.id,
        label: entry.label ?? 'Text', type: entry.type ?? 'text.typing' }); onRecorded();
    }
  }));
  let mutations = mutationsFor(original);
  const layout = (): TextLayerEditingLayout => ({
    layerId: mounted.getSnapshot().document!.activeLayerId!, preparationKey: 'fixture', sourceText: 'abcd', writingMode: 'horizontal-tb',
    localToDocument: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    layout: { schemaVersion: 2, key: 'fixture', glyphRuns: [], lines: [], selectionGeometry: [], clusterMap: [], warnings: [],
      inkBounds: { x: 0, y: 0, width: 40, height: 20 }, logicalBounds: { x: 0, y: 0, width: 40, height: 20 },
      caretStops: [0, 1, 2, 3, 4].map(textOffset => ({ textOffset, x: textOffset * 10, y: 0, height: 20, affinity: 'downstream' })) }
  });
  let renderer = { textEditingLayout: vi.fn(layout) }, projectedId = mounted.getSnapshot().document!.id;
  const scheduler = () => {
    let frame = 0; const frames = new Map<number, () => void>();
    return { frames, requestFrame: vi.fn((callback: () => void) => { frames.set(++frame, callback); return frame; }),
      cancelFrame: vi.fn((id: number) => { frames.delete(id); }) };
  };
  const firstClock = scheduler(); let clock = firstClock;
  const error = vi.fn();
  const source = {
    getSession: () => mounted, getRenderer: () => renderer, getProjectedDocumentId: () => projectedId,
    captureScope: () => captureInteractionScope({ getWorkspaceId: () => mounted.id, getRenderer: () => renderer,
      getLifecycleIdentity: () => lifecycle, getRendererGeneration: () => generation })
  };
  const render = (commit = true) => {
    hooks.cursor = 0;
    const editing = useTextEditingPublication({ ...source, commandService: commands, documentMutations: mutations,
      reportError: error, requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame });
    const selection = useTextSelectionGesture({ documentIdentity: mounted.id, session: mounted, renderer, lifecycle, generation },
      { ...source, editing, requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame });
    if (commit) flushLayout(); return { editing, selection };
  };
  const replace = (kind: string) => {
    if (kind === 'renderer') renderer = { textEditingLayout: vi.fn(layout) };
    if (kind === 'lifecycle') lifecycle = {};
    if (kind === 'generation') generation++;
    if (kind === 'disposed') original.dispose();
    if (kind === 'mixed') projectedId = successor.getSnapshot().document!.id;
    if (kind === 'session') { mounted = successor; projectedId = successor.getSnapshot().document!.id;
      mutations = mutationsFor(successor); workspace.activate(successor.id); }
    if (kind === 'service') commands = laterService;
    if (kind === 'clock') clock = scheduler();
  };
  return { original, successor, service, laterService, error, render, replace, firstClock,
    mutations: () => mutations,
    clock: () => clock, setOnRecorded: (callback: () => void) => { onRecorded = callback; },
    setOnPreview: (callback: () => void) => { onPreview = callback; },
    layerId: () => mounted.getSnapshot().document!.activeLayerId! };
};

describe('editing publication/selection composition (simulated hooks, actual text/session/history/Actions)', () => {
  it.each(['session', 'renderer', 'lifecycle'])('cancels a newly returned text transaction when prior-transaction close retires %s admission', kind => {
    const f = fixture(), { editing } = f.render(); editing.begin(f.layerId(), 4);
    const mutations = f.mutations();
    expect(mutations.begin('prior-no-op', undefined, () => f.replace(kind))).not.toBeNull();
    expect(editing.insert('must not appear')).toBe(false);
    expect(mutations.active).toBe(false); expect(f.mutations().active).toBe(false);
    expect(f.original.history.getSnapshot().undoDepth).toBe(0); expect(f.successor.history.getSnapshot().undoDepth).toBe(0);
    expect(f.service.actionRecordingSnapshot().steps).toHaveLength(0);
  });
  it('records the original committed edit exactly once after synchronous service/session handoff', () => {
    const f = fixture(), { editing } = f.render(); f.service.startActionRecording('Original'); f.laterService.startActionRecording('Later');
    const observed = vi.spyOn(f.service, 'recordObservedCommand');
    editing.begin(f.layerId(), 4); editing.insert('x');
    f.setOnRecorded(() => { f.replace('session'); f.replace('service'); f.render(); });
    expect(editing.finish()).toBe(true);
    expect(f.original.history.getSnapshot().undoDepth).toBe(1); expect(f.successor.history.getSnapshot().undoDepth).toBe(0);
    expect(f.service.actionRecordingSnapshot().steps).toMatchObject([
      { command: 'text.replaceRange', parameters: { start: 4, end: 4, text: 'x' } }
    ]);
    expect(f.laterService.actionRecordingSnapshot().steps).toHaveLength(0);
    expect(observed).toHaveBeenCalledExactlyOnceWith('text.replaceRange', f.original.id,
      { layerId: f.original.getSnapshot().document!.activeLayerId!, start: 4, end: 4, text: 'x' },
      { layerId: f.original.getSnapshot().document!.activeLayerId! });
  });
  it('keeps an admitted edit observer/scheduler across benign render, and uses the new binding for the next edit', () => {
    const f = fixture(), { editing } = f.render(); f.service.startActionRecording('Original'); f.laterService.startActionRecording('Later');
    editing.begin(f.layerId(), 4); editing.insert('x');
    f.replace('service'); f.replace('clock'); expect(f.render().editing).toBe(editing);
    expect(editing.checkpoint()).toBe(true); expect(f.firstClock.cancelFrame).toHaveBeenCalledOnce();
    expect(f.clock().cancelFrame).not.toHaveBeenCalled(); expect(f.service.actionRecordingSnapshot().steps).toHaveLength(1);
    editing.insert('y'); editing.finish(); expect(f.laterService.actionRecordingSnapshot().steps).toHaveLength(1);
  });
  it.each([false, true])('reports current observer failure, but keeps retired observer failure quiet (retired=%s)', retired => {
    const f = fixture(), { editing } = f.render();
    vi.spyOn(f.service, 'recordObservedCommand').mockImplementation(() => { throw new Error('observer failed'); });
    editing.begin(f.layerId(), 4); editing.insert('x');
    if (retired) f.setOnRecorded(() => { f.replace('session'); f.render(); });
    expect(editing.finish()).toBe(true); expect(f.original.history.getSnapshot().undoDepth).toBe(1);
    expect(f.error).toHaveBeenCalledTimes(retired ? 0 : 1);
  });
  it.each(['renderer', 'lifecycle', 'generation', 'session', 'disposed', 'mixed', 'editing', 'unmount'])
  ('drops the queued selection frame after %s retirement', kind => {
    const f = fixture(), { editing, selection } = f.render(); editing.begin(f.layerId(), 0);
    const publication = vi.spyOn(editing, 'setSelection');
    selection.begin(7, f.layerId(), { anchor: 0, focus: 0 }); selection.move(7, { x: 20, y: 0 });
    const queued = [...f.firstClock.frames.values()][0]!;
    if (kind === 'editing') { editing.reset(); editing.begin(f.layerId(), 1); }
    else if (kind === 'unmount') unmount(); else f.replace(kind);
    queued(); expect(publication).not.toHaveBeenCalled(); expect(f.original.history.getSnapshot().undoDepth).toBe(0);
  });
  it('retains coalescing/current geometry and the opening clock through ordinary rerender', () => {
    const f = fixture(), { editing, selection } = f.render(); editing.begin(f.layerId(), 0);
    const publication = vi.spyOn(editing, 'setSelection');
    selection.begin(7, f.layerId(), { anchor: 0, focus: 0 }); selection.move(7, { x: 10, y: 0 });
    f.replace('clock'); expect(f.render().selection).toBe(selection); selection.move(7, { x: 20, y: 0 });
    expect(f.firstClock.requestFrame).toHaveBeenCalledOnce(); expect(f.clock().requestFrame).not.toHaveBeenCalled();
    expect(selection.finish(7, { x: 30, y: 0 })).toBe(true);
    expect(editing.getSnapshot().selection).toEqual({ anchor: 0, focus: 3 }); expect(publication).toHaveBeenCalledOnce();
    expect(f.firstClock.cancelFrame).toHaveBeenCalledOnce(); expect(f.clock().cancelFrame).not.toHaveBeenCalled();
  });
  it('rechecks selection request runtime after its own typing prerequisite commits', () => {
    const f = fixture(), { editing, selection } = f.render(); editing.begin(f.layerId(), 4); editing.insert('x');
    f.setOnRecorded(() => f.replace('renderer'));
    selection.begin(7, f.layerId(), { anchor: 0, focus: 0 });
    expect(selection.finish(7, { x: 20, y: 0 })).toBe(true);
    expect(editing.getSnapshot().selection).toEqual({ anchor: 5, focus: 5 });
    expect(f.original.history.getSnapshot().undoDepth).toBe(1);
  });
  it('retires retained selection callbacks across StrictMode cleanup and admits a fresh gesture after reconnect', () => {
    const f = fixture(), { editing, selection } = f.render(); editing.begin(f.layerId(), 0);
    selection.begin(7, f.layerId(), { anchor: 0, focus: 0 }); selection.move(7, { x: 20, y: 0 });
    const queued = [...f.firstClock.frames.values()][0]!;
    unmount(); expect(selection.begin(8, f.layerId(), { anchor: 0, focus: 0 })).toBe(false);
    hooks.slots.forEach((slot, index) => { if (slot?.deps) hooks.slots[index] = undefined; });
    expect(f.render().selection).toBe(selection);
    selection.begin(7, f.layerId(), { anchor: 0, focus: 0 }); selection.move(7, { x: 30, y: 0 });
    queued(); expect(editing.getSnapshot().selection).toEqual({ anchor: 0, focus: 0 });
    expect(selection.finish(7, { x: 40, y: 0 })).toBe(true);
    expect(editing.getSnapshot().selection).toEqual({ anchor: 0, focus: 4 });
  });
});
