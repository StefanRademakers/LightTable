import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type ImageDocument } from '../../editor/document/documentTypes';
import { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';
import { DocumentSelectionStateStore } from '../tools/selection/DocumentSelectionStateStore';
import type { TransformSelectionPublicationBinding, TransformPublicationRenderer } from '../tools/transform/TransformPublicationOwner';
import { DocumentSession, type DocumentSessionId } from './documentSession';
import { DocumentSelectionPublicationBinding } from './DocumentSelectionPublicationBinding';

const setup = () => {
  const before = createImageDocument('Before', 12, 10, 'before');
  const after = { ...before, revision: before.revision + 1 };
  const session = new DocumentSession({ id: 'publication-binding' as DocumentSessionId,
    source: { id: 'source', name: 'image.png', mediaType: 'image/png' } });
  session.setDocument(before);
  session.setReady();
  const store = new DocumentSelectionStateStore(session);
  const expectedLease = store.acquire(session.getSnapshot().documentRevision);
  const coverage = SelectionMaskSnapshot.inactive(12, 10);
  let projected: ImageDocument = before;
  let current = true;
  let generation = 1;
  const renderer: TransformPublicationRenderer = {
    publishTransformState: vi.fn(async publish => { publish(); }),
    applyPixelHistory: vi.fn(() => true), commitLayerTransform: vi.fn(() => null),
    cancelLayerTransform: vi.fn(() => true), captureTransformSelectionPreview: vi.fn(async () => coverage)
  };
  const publishEditorProjection = vi.fn();
  const owner = new DocumentSelectionPublicationBinding(session, {
    isSessionCurrent: () => current,
    getDocument: () => projected, getRenderer: () => renderer,
    getRendererGeneration: () => generation,
    applyDocumentSnapshot: next => { projected = next; }, publishEditorProjection
  });
  const publishPixels = vi.fn(() => () => undefined);
  const binding: TransformSelectionPublicationBinding = {
    renderer, rendererGeneration: generation, expectedDocument: before, expectedSelectionLease: expectedLease,
    publishPixels
  };
  return { before, after, session, store, coverage, owner, renderer, binding,
    publishPixels, publishEditorProjection, projected: () => projected,
    retire: () => { current = false; }, replaceGeneration: () => { generation++; }
  };
};

describe('document/selection publication binding', () => {
  it('publishes one compound surface value and projects the exact canonical selection revision', () => {
    const state = setup();
    const notifications = vi.fn();
    state.session.subscribe(notifications);
    state.owner.publishSurface(state.after, [], state.coverage);
    const snapshot = state.session.getSnapshot();
    expect(snapshot.document).toBe(state.after);
    expect(snapshot.editor.selectionMaskSnapshot).toBe(state.coverage);
    expect(state.publishEditorProjection).toHaveBeenCalledWith({
      selection: [], coverage: state.coverage, supportBounds: null,
      selectionRevision: snapshot.editor.selectionRevision
    });
    expect(notifications).toHaveBeenCalledOnce();
  });

  it('rejects a retired surface owner without mutating either session or projection', () => {
    const state = setup();
    state.retire();
    expect(() => state.owner.publishSurface(state.after, [], state.coverage)).toThrow('current document session');
    expect(state.session.getSnapshot().document).toBe(state.before);
    expect(state.publishEditorProjection).not.toHaveBeenCalled();
  });

  it('publishes cached exact mask support, not the feather-expanded provenance rectangle', () => {
    const state = setup();
    const words = new Uint16Array(12 * 10);
    words[4 * 12 + 3] = 0x3800;
    words[5 * 12 + 4] = 0x3c00;
    const coverage = SelectionMaskSnapshot.fromRaw(12, 10, words);
    const selection = [{ mode: 'replace' as const, amount: 6,
      shape: { kind: 'ellipse' as const, points: [{ x: 0, y: 0 }, { x: 12, y: 10 }] } }];
    state.owner.publishSurface(state.after, selection, coverage);
    const editor = state.session.getSnapshot().editor;
    expect(editor.selectionSupportBounds).toEqual({ x: 3, y: 4, width: 2, height: 2 });
    expect(editor.selectionMaskSnapshot).toBe(coverage);
    expect(state.publishEditorProjection).toHaveBeenCalledWith(expect.objectContaining({
      supportBounds: editor.selectionSupportBounds, coverage,
    }));
  });

  it('keeps fully clipped coverage active without inventing a copy area from provenance', () => {
    const state = setup();
    const coverage = SelectionMaskSnapshot.fromRaw(12, 10, new Uint16Array(120));
    state.owner.publishSurface(state.after, [{ mode: 'replace',
      shape: { kind: 'rectangle', points: [{ x: 30, y: 30 }, { x: 40, y: 40 }] } }], coverage);
    const lease = state.store.acquire(state.session.getSnapshot().documentRevision);
    expect(lease.selection.active).toBe(true);
    expect(lease.selection.supportBounds).toBeNull();
    expect(state.session.getSnapshot().editor.selectionSupportBounds).toBeNull();
  });

  it('does not rediscover another session if a transform renderer queue resumes after retirement', async () => {
    const state = setup();
    vi.mocked(state.renderer.publishTransformState).mockImplementation(async publish => {
      await Promise.resolve();
      state.retire();
      publish();
    });
    await expect(state.owner.publishTransform(state.after, [], state.coverage, state.binding))
      .rejects.toThrow('changed during restoration');
    expect(state.publishPixels).not.toHaveBeenCalled();
    expect(state.session.getSnapshot().document).toBe(state.before);
  });

  it('rejects a renderer generation replacement during queued transform publication', async () => {
    const state = setup();
    vi.mocked(state.renderer.publishTransformState).mockImplementation(async publish => {
      state.replaceGeneration();
      publish();
    });
    await expect(state.owner.publishTransform(state.after, [], state.coverage, state.binding))
      .rejects.toThrow('changed during restoration');
    expect(state.publishPixels).not.toHaveBeenCalled();
  });

  it('uses addressability after CAS instead of rechecking the now-obsolete opening lease', async () => {
    const state = setup();
    await state.owner.publishTransform(state.after, [], state.coverage, state.binding);
    expect(state.publishPixels).toHaveBeenCalledOnce();
    expect(state.projected()).toBe(state.after);
    expect(state.session.getSnapshot().editor.selectionMaskSnapshot).toBe(state.coverage);
    expect(state.publishEditorProjection).toHaveBeenCalledOnce();
  });

  it('delegates exact synchronous compensation if editor projection fails after pixel publication', async () => {
    const state = setup();
    const inverse = vi.fn();
    state.publishPixels.mockReturnValue(inverse);
    state.publishEditorProjection.mockImplementation(() => { throw new Error('projection failed'); });
    await expect(state.owner.publishTransform(state.after, [], state.coverage, state.binding))
      .rejects.toThrow('projection failed');
    expect(inverse).toHaveBeenCalledOnce();
    expect(state.projected()).toBe(state.before);
    expect(state.session.getSnapshot().document).toBe(state.before);
  });
});
