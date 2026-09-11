import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import type { EditorSession } from '../../editor/session/editorSession';
import { SelectionMaskSnapshot } from '../../editor/selection/SelectionMaskSnapshot';
import type { EditorHistoryEntry } from '../commands/useDocumentHistoryController';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { captureInteractionScope } from '../interactions/captureInteractionScope';
import { DocumentSurfaceCommandService, type DocumentSurfaceRenderer } from './DocumentSurfaceCommandService';
import type { ReversibleDocumentSurfaceMutation } from './commitDocumentSurfaceMutation';

const resize = { width: 200, height: 100, resolutionPpi: 72, resample: true,
  method: 'nearest' as const, preserveDetailsNoiseReduction: 0, scaleStyles: true };
const setup = () => {
  const before = createImageDocument('Surface', 100, 50, 'pixels');
  let document = before;
  let surface = before;
  let generation = 1;
  let workspace = 'first';
  let lifecycle = {};
  let selection: Pick<EditorSession, 'selection' | 'selectionMaskSnapshot'> = {
    selection: [{ mode: 'replace', shape: { kind: 'rectangle', points: [{ x: 10, y: 5 }, { x: 30, y: 25 }] } }],
    selectionMaskSnapshot: SelectionMaskSnapshot.inactive(100, 50)
  };
  const entries: EditorHistoryEntry[] = [];
  const runtime: ReversibleDocumentSurfaceMutation = {
    resourceOwner: {}, retainForHistory: vi.fn(), setAfterSelectionActive: vi.fn(),
    apply: vi.fn(), dispose: vi.fn(), disposeAfterOwnershipLoss: vi.fn()
  };
  const renderer: DocumentSurfaceRenderer = {
    captureSelectionSnapshot: vi.fn(async () => SelectionMaskSnapshot.inactive(surface.width, surface.height)),
    restoreSelectionSnapshot: vi.fn(async () => true),
    resizeDocumentSurface: vi.fn(next => { surface = next; }),
    resizeImagePixels: vi.fn(() => runtime), applyDocumentGeometryPixels: vi.fn(() => runtime)
  };
  let currentRenderer: DocumentSurfaceRenderer | null = renderer;
  const mutations = createDocumentMutationController(() => ({
    getDocument: () => document,
    applySnapshot: next => { document = next; },
    previewSnapshot: () => undefined, discardPreview: () => undefined,
    pushHistoryEntry: () => { throw new Error('Generic history must not be used.'); }
  }));
  const admission = { run: <T>(operation: () => T) => operation(), release: vi.fn() };
  const acquire = vi.fn(() => admission);
  const settle = vi.fn(async () => undefined);
  const publishHistoryState = vi.fn<ConstructorParameters<typeof DocumentSurfaceCommandService>[0]['publication']['publishHistoryState']>(
    async (_owner, publish) => publish((next) => { surface = next; })
  );
  const push = vi.fn((entry: EditorHistoryEntry) => { entries.push(entry); });
  const ports: ConstructorParameters<typeof DocumentSurfaceCommandService>[0] = {
    session: { acquirePublicationAdmission: acquire }, mutations,
    captureScope: () => captureInteractionScope({
      getWorkspaceId: () => workspace, getLifecycleIdentity: () => lifecycle,
      getRenderer: () => currentRenderer, getRendererGeneration: () => generation
    }),
    settleInteraction: settle, getRenderer: () => currentRenderer,
    getDocument: () => document, getSelection: () => selection,
    publication: {
      publishHistoryState, pushHistoryEntry: push,
      publishDocumentSelection: (next, operations, coverage) => {
        document = next;
        selection = { selection: [...operations], selectionMaskSnapshot: coverage };
      }
    }
  };
  return {
    service: new DocumentSurfaceCommandService(ports), ports, before, renderer,
    runtime, mutations, entries, acquire, admission, settle, push, publishHistoryState,
    get document() { return document; }, get selection() { return selection; },
    changeDocument: () => { document = { ...document, revision: document.revision + 1, name: 'Settled' }; },
    replaceSelection: () => { selection = { ...selection, selection: [...selection.selection] }; },
    retire: (kind: string) => {
      if (kind === 'workspace') workspace = 'second';
      if (kind === 'lifecycle') lifecycle = {};
      if (kind === 'generation') generation++;
      if (kind === 'renderer') currentRenderer = { ...renderer };
    }
  };
};

describe('DocumentSurfaceCommandService', () => {
  it('plans against the document committed by prerequisite settlement, then publishes one exact history route', async () => {
    const f = setup();
    f.settle.mockImplementation(async () => { f.changeDocument(); f.replaceSelection(); });
    await expect(f.service.resizeImage(resize)).resolves.toBe(true);
    expect(f.renderer.resizeImagePixels).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Settled', width: 100 }),
      expect.objectContaining({ targetWidth: 200, targetHeight: 100 }), 0
    );
    expect(f.document).toMatchObject({ width: 200, height: 100, name: 'Settled' });
    expect(f.selection.selection[0]?.transform).toEqual({ a: 2, b: 0, c: 0, d: 2, tx: 0, ty: 0 });
    expect(f.selection.selectionMaskSnapshot).toMatchObject({ width: 200, height: 100 });
    expect(f.entries).toHaveLength(1);
    expect(f.entries[0]?.type).toBe('document.image-size');
    expect(f.runtime.retainForHistory).toHaveBeenCalledOnce();
    expect(f.admission.release).toHaveBeenCalledOnce();
    f.retire('renderer');
    await f.entries[0]!.undo();
    expect(f.publishHistoryState).toHaveBeenCalledOnce();
    expect(f.document).toMatchObject({ width: 100, height: 50, name: 'Settled' });
    await f.entries[0]!.redo();
    expect(f.document.width).toBe(200);
  });

  it.each(['workspace', 'lifecycle', 'generation', 'renderer'])('rejects %s retirement during settlement before transaction/GPU work', async kind => {
    const f = setup();
    f.settle.mockImplementation(async () => { f.retire(kind); });
    await expect(f.service.resizeImage(resize)).rejects.toThrow('retired document renderer');
    expect(f.mutations.active).toBe(false);
    expect(f.renderer.resizeImagePixels).not.toHaveBeenCalled();
    expect(f.acquire).not.toHaveBeenCalled();
    expect(f.document).toBe(f.before);
  });

  it('does not acquire GPU/publication/history for unchanged dimensions and resolution', async () => {
    const f = setup();
    await expect(f.service.resizeImage({ ...resize, width: 100, height: 50, resolutionPpi: f.before.resolutionPpi })).resolves.toBe(false);
    await expect(f.service.applyGeometry({ operation: 'canvas-size', width: 100, height: 50, anchorX: 0.5, anchorY: 0.5 })).resolves.toBe(false);
    expect(f.acquire).not.toHaveBeenCalled();
    expect(f.renderer.resizeImagePixels).not.toHaveBeenCalled();
    expect(f.renderer.applyDocumentGeometryPixels).not.toHaveBeenCalled();
    expect(f.entries).toHaveLength(0);
    expect(f.mutations.active).toBe(false);
  });

  it('keeps resolution-only edits semantic and selection geometry unchanged', async () => {
    const f = setup();
    const selection = f.selection.selection;
    await expect(f.service.resizeImage({ ...resize, resample: false, resolutionPpi: 300 })).resolves.toBe(true);
    expect(f.document).toMatchObject({ width: 100, height: 50, resolutionPpi: 300 });
    expect(f.selection.selection).toEqual(selection);
    expect(f.renderer.resizeImagePixels).toHaveBeenCalledWith(f.before,
      expect.objectContaining({ targetWidth: 100, targetHeight: 50, passes: [] }), 0);
    expect(f.entries).toHaveLength(1);
  });

  it('uses the geometry planner and existing compound publisher for rotation', async () => {
    const f = setup();
    await expect(f.service.applyGeometry({ operation: 'rotate', rotation: 'clockwise-90' })).resolves.toBe(true);
    expect(f.document).toMatchObject({ width: 50, height: 100 });
    expect(f.renderer.applyDocumentGeometryPixels).toHaveBeenCalledWith(f.before,
      expect.objectContaining({ sampling: 'exact-orthogonal', targetWidth: 50, targetHeight: 100 }));
    expect(f.entries[0]?.label).toBe('Image Rotation');
    await f.entries[0]!.undo();
    expect(f.document).toBe(f.before);
  });

  it('rejects selection replacement during exact-mask preparation without executing pixels', async () => {
    const f = setup();
    vi.mocked(f.renderer.restoreSelectionSnapshot).mockImplementation(async () => { f.replaceSelection(); return true; });
    await expect(f.service.resizeImage(resize)).rejects.toThrow('lost its document or selection ownership');
    expect(f.renderer.resizeImagePixels).not.toHaveBeenCalled();
    expect(f.mutations.active).toBe(false);
    expect(f.entries).toHaveLength(0);
  });

  it('restores the baseline and exposes a failed history publication', async () => {
    const f = setup();
    f.push.mockImplementation(() => { throw new Error('History rejected'); });
    await expect(f.service.resizeImage(resize)).rejects.toThrow('History rejected');
    expect(f.document).toBe(f.before);
    expect(f.runtime.apply).toHaveBeenCalledWith('before');
    expect(f.runtime.dispose).toHaveBeenCalledOnce();
    expect(f.mutations.active).toBe(false);
    expect(f.admission.release).toHaveBeenCalledOnce();
  });

  it('fails closed when there is no document session, without settling another editor', async () => {
    const f = setup();
    const service = new DocumentSurfaceCommandService({ ...f.ports, session: undefined });
    await expect(service.resizeImage(resize)).rejects.toThrow('admitted document session');
    expect(f.settle).not.toHaveBeenCalled();
  });

  it('releases the document reservation and reports invalid planning before GPU work', async () => {
    const f = setup();
    await expect(f.service.applyGeometry({ operation: 'crop', bounds: { x: 5, y: 5, width: 0, height: 10 } })).rejects.toThrow();
    expect(f.mutations.active).toBe(false);
    expect(f.acquire).not.toHaveBeenCalled();
    expect(f.renderer.applyDocumentGeometryPixels).not.toHaveBeenCalled();
    expect(f.document).toBe(f.before);
  });
});
