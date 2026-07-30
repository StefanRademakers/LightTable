import { describe, expect, it, vi } from 'vitest';
import type { DocumentSessionId } from '../documents/documentSession';
import { WorkspaceSession } from './workspaceSession';

const source = (id: string) => ({
  id,
  name: `${id}.png`,
  mediaType: 'image/png',
  byteLength: 100
});

const ids = (...values: string[]) => {
  let index = 0;
  return () => values[index++] as DocumentSessionId;
};

describe('WorkspaceSession', () => {
  it('opens documents and exposes exactly one active document', () => {
    const workspace = new WorkspaceSession({
      createId: ids('one', 'two')
    });

    const first = workspace.open({ source: source('first') });
    const second = workspace.open({ source: source('second') });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(workspace.getSnapshot().documentOrder).toEqual(['one', 'two']);
    expect(workspace.getSnapshot().activeDocumentId).toBe('two');
    expect(workspace.getActiveDocument()?.id).toBe('two');
  });

  it('keeps mutable editor and viewport state isolated per document', () => {
    const workspace = new WorkspaceSession({
      createId: ids('one', 'two')
    });
    const first = workspace.open({ source: source('first') });
    const second = workspace.open({ source: source('second') });
    if (!first.ok || !second.ok) throw new Error('Fixture failed to open.');

    first.value.setReady();
    second.value.setReady();
    first.value.updateEditor((current) => ({
      ...current,
      activeTool: 'brush',
      brush: { ...current.brush, size: 125 }
    }));
    first.value.updateViewport((current) => ({
      ...current,
      zoomMode: 'custom',
      scale: 2.5,
      panX: 24
    }));

    workspace.activate(second.value.id);
    expect(workspace.getActiveDocument()?.getSnapshot().editor.activeTool).toBe('view');
    expect(workspace.getActiveDocument()?.getSnapshot().viewport.scale).toBe(1);

    workspace.activate(first.value.id);
    const restored = workspace.getActiveDocument()?.getSnapshot();
    expect(restored?.editor.activeTool).toBe('brush');
    expect(restored?.editor.brush.size).toBe(125);
    expect(restored?.viewport).toMatchObject({
      zoomMode: 'custom',
      scale: 2.5,
      panX: 24
    });
  });

  it('prevents dirty documents from closing without an explicit policy', () => {
    const workspace = new WorkspaceSession({
      createId: ids('one')
    });
    const opened = workspace.open({ source: source('first') });
    if (!opened.ok) throw new Error('Fixture failed to open.');
    opened.value.setReady();
    opened.value.markChanged();

    expect(workspace.close(opened.value.id)).toEqual({
      ok: false,
      error: { code: 'document-is-dirty', documentId: 'one' }
    });
    expect(workspace.getDocument(opened.value.id)).toBe(opened.value);

    expect(workspace.close(opened.value.id, { discardChanges: true }).ok).toBe(true);
    expect(workspace.getSnapshot().activeDocumentId).toBeNull();
  });

  it('selects the nearest remaining document after closing the active tab', () => {
    const workspace = new WorkspaceSession({
      createId: ids('one', 'two', 'three')
    });
    const one = workspace.open({ source: source('one') });
    const two = workspace.open({ source: source('two') });
    const three = workspace.open({ source: source('three') });
    if (!one.ok || !two.ok || !three.ok) throw new Error('Fixture failed to open.');

    workspace.activate(two.value.id);
    workspace.close(two.value.id);

    expect(workspace.getSnapshot().documentOrder).toEqual(['one', 'three']);
    expect(workspace.getSnapshot().activeDocumentId).toBe('three');
  });

  it('activates but does not duplicate an already open source', () => {
    const workspace = new WorkspaceSession({
      createId: ids('one', 'two')
    });
    const first = workspace.open({ source: source('same') });
    if (!first.ok) throw new Error('Fixture failed to open.');
    workspace.open({ source: source('other') });

    const duplicate = workspace.open({ source: source('same') });

    expect(duplicate).toEqual({
      ok: false,
      error: { code: 'duplicate-source', sourceId: 'same' }
    });
    expect(workspace.getSnapshot().documentOrder).toEqual(['one', 'two']);
    expect(workspace.getSnapshot().activeDocumentId).toBe('one');
  });

  it('publishes document changes and disposes registered runtimes', () => {
    const workspace = new WorkspaceSession({
      createId: ids('one')
    });
    const workspaceListener = vi.fn();
    workspace.subscribe(workspaceListener);
    const opened = workspace.open({ source: source('first') });
    if (!opened.ok) throw new Error('Fixture failed to open.');
    const disposeRuntime = vi.fn();
    opened.value.registerDisposer(disposeRuntime);

    opened.value.setReady();
    opened.value.markChanged(4);
    expect(workspace.getSnapshot().documents.one.documentRevision).toBe(4);

    workspace.close(opened.value.id, { discardChanges: true });
    expect(disposeRuntime).toHaveBeenCalledOnce();
    expect(workspaceListener).toHaveBeenCalled();
  });
});
