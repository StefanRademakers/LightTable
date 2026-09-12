import { expect, it, vi } from 'vitest';
import { createImageDocument } from '../../../editor/document/documentTypes';
import { createRasterLayer } from '../../../editor/document/documentCommands';
import { createEditorSession, type EditorSession } from '../../../editor/session/editorSession';
import { SelectionMaskSnapshot } from '../../../editor/selection/SelectionMaskSnapshot';
import { SelectionGestureHostBinding, type SelectionGestureHostInputs } from './SelectionGestureHostBinding';

const setup = () => {
  let current = true;
  let input: SelectionGestureHostInputs = { document: createImageDocument('Snap', 100, 100, 'asset'),
    editor: createEditorSession(), selectedLayerIds: [], scale: 1 };
  const draft = vi.fn(); const snapFeedback = vi.fn();
  let pending: ((editor: EditorSession) => EditorSession) | null = null;
  const updateEditor = vi.fn((update: (editor: EditorSession) => EditorSession) => { pending = update; });
  const binding = new SelectionGestureHostBinding(() => input, { updateEditor, draft, snapFeedback }, () => current);
  return { binding, draft, snapFeedback, updateEditor,
    read: () => input, change: (change: Partial<SelectionGestureHostInputs>) => { input = { ...input, ...change }; },
    flush: () => { input = { ...input, editor: pending!(input.editor) }; pending = null; },
    retire: () => { current = false; } };
};

it('publishes pointer only and cannot overwrite a newer kernel selection between scheduling and publication', () => {
  const f = setup(); f.binding.publishPointer(7);
  const snapshot = SelectionMaskSnapshot.inactive(100, 100);
  const selection: EditorSession['selection'] = [{ mode: 'replace',
    shape: { kind: 'rectangle', points: [{ x: 1, y: 2 }, { x: 10, y: 20 }] } }];
  const bounds = { x: 1, y: 2, width: 9, height: 18 };
  f.change({ editor: { ...f.read().editor, selection, selectionMaskSnapshot: snapshot,
    selectionRevision: 42, selectionSupportBounds: bounds } });
  f.flush();
  expect(f.read().editor.pointerId).toBe(7);
  expect(f.binding.getSelection()).toBe(selection);
  expect(f.binding.getSelectionMaskSnapshot()).toBe(snapshot);
  expect(f.binding.getSelectionSupportBounds()).toBe(bounds);
  expect(f.read().editor.selectionRevision).toBe(42);
});

it('guards retained callbacks and pending updater after exact scope retirement', () => {
  const f = setup(); f.binding.publishPointer(8);
  const before = f.read().editor; f.retire(); f.flush();
  expect(f.read().editor).toBe(before);
  f.binding.publishPointer(null); f.binding.publishDraft(null); f.binding.publishSnapFeedback([], null);
  expect(f.updateEditor).toHaveBeenCalledOnce();
  expect(f.draft).not.toHaveBeenCalled(); expect(f.snapFeedback).not.toHaveBeenCalled();
  expect(f.binding.getDocument()).toBeNull();
  expect(f.binding.getSnapContext({ x: 0, y: 0, width: 10, height: 10 }).enabled).toBe(false);
});

it('reads current snap preferences and scale, excludes active plus selected layers, and bounds grid spacing', () => {
  const f = setup();
  const first = f.read().document!;
  const document = createRasterLayer(first, 'Second');
  f.change({ document, selectedLayerIds: [first.activeLayerId!] });
  const bounds = { x: 12, y: 12, width: 10, height: 10 };
  expect(f.binding.getSnapContext(bounds).targets.filter(target => target.source === 'layer')).toEqual([]);
  f.change({ scale: 3, editor: { ...f.read().editor, snap: { ...f.read().editor.snap,
    enabled: false, gridVisible: true, gridSpacing: 20, gridSubdivisions: 0,
    targets: { layers: false, guides: false, documentBounds: false, grid: true } } } });
  const context = f.binding.getSnapContext(bounds);
  expect(context.zoom).toBe(3); expect(context.enabled).toBe(false);
  expect(context.targets).toContainEqual(expect.objectContaining({ source: 'grid', position: 20 }));
  f.change({ editor: { ...f.read().editor, snap: { ...f.read().editor.snap, gridVisible: false } } });
  expect(f.binding.getSnapContext(bounds).targets).toEqual([]);
});
