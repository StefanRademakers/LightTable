import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSession } from '../workspace/workspaceSession';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { createMountedAutomationGestureBinding } from './MountedAutomationGestureBinding';
import type { BrushSettings } from '../../editor/session/editorSession';
import type { LightTableGestureKind } from './lightTableCommandContract';

const workspaces: WorkspaceSession[] = [];
afterEach(() => { for (const workspace of workspaces.splice(0)) workspace.dispose(); });
const fixture = () => {
  const workspace = new WorkspaceSession({ createId: () => 'same-id' as never }); workspaces.push(workspace);
  const opened = workspace.open({ source: { id: 'image', name: 'Image', mediaType: 'image/png' } });
  if (!opened.ok) throw new Error('Fixture failed');
  const session = opened.value; session.setDocument(createImageDocument('Image', 100, 100, 'image')); session.setReady();
  let currentSession = session; let renderer = {}; let generation = 1;
  const selection = { begin: vi.fn(() => true), move: vi.fn(() => true), finish: vi.fn(() => true), cancel: vi.fn(() => true),
    beginPaint: vi.fn(() => true), movePaint: vi.fn(() => true), finishPaint: vi.fn(() => true), cancelPaint: vi.fn(() => true) };
  const paint = { begin: vi.fn(() => true), move: vi.fn(() => true), finish: vi.fn(() => true), cancel: vi.fn(() => true) };
  const history = vi.fn();
  const mutations = createDocumentMutationController(() => ({ getDocument: () => session.getSnapshot().document,
    applySnapshot: document => session.setDocument(document), previewSnapshot: vi.fn(), discardPreview: vi.fn(), pushHistoryEntry: history }));
  const host = { getCurrentSession: () => currentSession, getCurrentRenderer: () => renderer,
    captureRendererScope: () => { const opening = generation; return { isCurrent: () => generation === opening }; } };
  const ports = { getDocument: () => session.getSnapshot().document, getBrush: () => ({ size: 30 } as BrushSettings),
    selection, paint, documentMutations: mutations };
  const binding = createMountedAutomationGestureBinding(session, renderer, host, () => ports);
  return { session, binding, selection, paint, history, ports, host,
    get renderer() { return renderer; }, changeRenderer: () => { renderer = {}; },
    changeGeneration: () => { generation++; }, changeSession: (next: typeof session) => { currentSession = next; } };
};

describe('MountedAutomationGestureBinding', () => {
  it.each(['selection-rectangle', 'selection-paint', 'brush-stroke', 'layer-translate'] as LightTableGestureKind[])(
    'pins %s kind and pointer; wrong terminal cannot consume the lease', kind => {
      const f = fixture(); const parameters = { layerId: f.session.getSnapshot().document!.activeLayerId };
      expect(f.binding.beginGesture(kind, 7, parameters, { x: 1, y: 2 })).toBe(true);
      expect(f.binding.beginGesture(kind, 8, parameters, { x: 1, y: 2 })).toBe(false);
      expect(f.binding.updateGesture(kind, 8, { x: 9, y: 9 })).toBe(false);
      expect(f.binding.finishGesture(kind, 8, true)).toBe(false);
      expect(f.binding.updateGesture(kind, 7, { x: 9, y: 9 })).toBe(true);
      expect(f.binding.finishGesture(kind, 7, true)).toBe(true);
    });
  it.each(['renderer', 'generation', 'session', 'disposed'] as const)('rejects %s retirement and cancels only its captured pointer', kind => {
    const f = fixture(); f.binding.beginGesture('brush-stroke', 7, {}, { x: 1, y: 2 });
    if (kind === 'renderer') f.changeRenderer();
    else if (kind === 'generation') f.changeGeneration();
    else if (kind === 'session') f.changeSession(fixture().session);
    else f.session.dispose();
    expect(f.binding.updateGesture('brush-stroke', 7, { x: 9, y: 9 })).toBe(false);
    expect(f.paint.move).not.toHaveBeenCalled(); expect(f.paint.cancel).toHaveBeenCalledExactlyOnceWith(7);
  });
  it('permanently closes retained callbacks and rejects an old token in a replacement binding', () => {
    const f = fixture(); f.binding.beginGesture('selection-rectangle', 7, {}, { x: 1, y: 2 });
    f.binding.retire(); f.binding.retire();
    expect(f.selection.cancel).toHaveBeenCalledExactlyOnceWith(7);
    expect(f.binding.beginGesture('selection-rectangle', 8, {}, { x: 1, y: 2 })).toBe(false);
    const next = createMountedAutomationGestureBinding(f.session, f.renderer, f.host, () => f.ports);
    next.beginGesture('selection-rectangle', 9, {}, { x: 1, y: 2 });
    expect(next.finishGesture('selection-rectangle', 7, false)).toBe(false);
    expect(next.finishGesture('selection-rectangle', 9, true)).toBe(true);
  });
  it('preserves controller parameters and rejects invalid sampled operators before begin', () => {
    const f = fixture();
    f.binding.beginGesture('selection-paint', 7, { mode: 'subtract', size: 31, hardness: 0.4, opacity: 0.8, smooth: 0.1 }, { x: 1, y: 2 });
    expect(f.selection.beginPaint).toHaveBeenCalledWith(7, { x: 1, y: 2, pressure: 1 }, 'subtract',
      { size: 31, hardness: 0.4, opacity: 0.8, smooth: 0.1 });
    f.binding.finishGesture('selection-paint', 7, false);
    expect(f.binding.beginGesture('brush-stroke', 8, { operator: { invalid: true } }, { x: 1, y: 2 })).toBe(false);
    expect(f.paint.begin).not.toHaveBeenCalled();
  });
});
