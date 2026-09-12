import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSession } from '../workspace/workspaceSession';
import { createDocumentMutationController } from '../documents/useDocumentMutationController';
import { createImageDocument } from '../../editor/document/documentTypes';
import { createRasterLayer } from '../../editor/document/documentCommands';
import * as normalizer from './normalizeEditableSvgSource';
import { createMountedSvgImportBinding } from './createMountedSvgImportBinding';

const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
const command = { svg, placement: 'document' as const };
const fixture = () => {
  const workspace = new WorkspaceSession();
  const opened = workspace.open({ source: { id: 'source', name: 'SVG', mediaType: 'image/svg+xml' } });
  if (!opened.ok) throw new Error('Fixture failed to open');
  const session = opened.value;
  session.setDocument(createImageDocument('SVG', 100, 100, 'source'));
  session.setReady();
  let current = session;
  let rendererCurrent = true;
  const history = vi.fn();
  const mutation = createDocumentMutationController(() => ({
    getDocument: () => session.getSnapshot().document,
    applySnapshot: (document) => session.setDocument(document),
    pushHistoryEntry: history, previewSnapshot: () => undefined, discardPreview: () => undefined
  }));
  const importSvg = createMountedSvgImportBinding(session, {
    getCurrentSession: () => current,
    captureRendererScope: () => ({ isCurrent: () => rendererCurrent }),
    changeDocument: mutation.change
  });
  return { workspace, session, history, importSvg,
    switchSession: (next: typeof session) => { current = next; },
    retireRenderer: () => { rendererCurrent = false; }
  };
};

describe('mounted SVG import admission', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects a retained registered port before normalization when another session is mounted', async () => {
    const first = fixture(); const successor = fixture();
    const normalize = vi.spyOn(normalizer, 'normalizeEditableSvgSource');
    first.switchSession(successor.session);
    await expect(first.importSvg(command)).rejects.toThrow('scope is no longer current');
    expect(normalize).not.toHaveBeenCalled();
    expect(first.history).not.toHaveBeenCalled();
    first.workspace.dispose(); successor.workspace.dispose();
  });

  it('rejects disposal before normalization, even before the mounted ref is replaced', async () => {
    const host = fixture();
    const normalize = vi.spyOn(normalizer, 'normalizeEditableSvgSource');
    host.session.dispose();
    await expect(host.importSvg(command)).rejects.toThrow('scope is no longer current');
    expect(normalize).not.toHaveBeenCalled();
    host.workspace.dispose();
  });

  it('rejects renderer retirement during preparation without creating history', async () => {
    const host = fixture();
    let release!: (value: string) => void;
    vi.spyOn(normalizer, 'normalizeEditableSvgSource').mockImplementation(() => (
      new Promise(resolve => { release = resolve; })
    ));
    const before = host.session.getSnapshot().document;
    const pending = host.importSvg(command);
    host.retireRenderer(); release(svg);
    await expect(pending).rejects.toThrow('scope is no longer current');
    expect(host.session.getSnapshot().document).toBe(before);
    expect(host.history).not.toHaveBeenCalled();
    host.workspace.dispose();
  });

  it('preserves an intervening same-session edit and commits the accepted import once', async () => {
    const host = fixture();
    let release!: (value: string) => void;
    vi.spyOn(normalizer, 'normalizeEditableSvgSource').mockImplementation(() => (
      new Promise(resolve => { release = resolve; })
    ));
    const pending = host.importSvg(command);
    const edited = createRasterLayer(host.session.getSnapshot().document!, 'Intervening');
    host.session.setDocument(edited); release(svg);
    const result = await pending;
    expect(result?.layerId).toBe(host.session.getSnapshot().document?.layers.at(-1)?.id);
    expect(host.session.getSnapshot().document?.layers.slice(0, edited.layers.length)).toEqual(edited.layers);
    expect(host.history).toHaveBeenCalledOnce();
    host.workspace.dispose();
  });
});
