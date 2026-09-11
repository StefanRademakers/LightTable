import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type DocumentFontAsset } from '../../editor/document/documentTypes';
import { fingerprintFontBytes } from '../../text/fonts/DocumentFontRegistry';
import { DocumentSession, type DocumentSessionId } from './documentSession';
import { DocumentLoadedSourceBinding } from './DocumentLoadedSourceBinding';

const setup = () => {
  const session = new DocumentSession({ id: 'fonts' as DocumentSessionId,
    source: { id: 'source', name: 'test', mediaType: 'image/png' } });
  const document = createImageDocument('test', 20, 10, 'image');
  session.setDocument(document);
  const port = { isCurrent: () => true, getDocument: () => session.getSnapshot().document,
    metadata: vi.fn(), source: vi.fn(), fontPending: vi.fn(), fontError: vi.fn() };
  const binding = new DocumentLoadedSourceBinding(session, session.fontHydration, port);
  return { session, document, port, binding };
};

const delayedFont = async () => {
  const bytes = new Uint8Array([0, 1, 0, 0]);
  const fingerprintSha256 = await fingerprintFontBytes(bytes);
  const metadata: DocumentFontAsset = { assetId: 'font', faceIndex: 0, fingerprintSha256,
    source: 'document', container: 'sfnt', outline: 'truetype', familyNames: ['Fixture'],
    styleName: 'Regular', weight: 400, stretch: 100, italic: false, byteLength: bytes.length,
    embedding: { level: 'editable', noSubsetting: false, bitmapOnly: false } };
  let resolve!: (bytes: ArrayBuffer) => void;
  let reject!: (error: Error) => void;
  const read = new Promise<ArrayBuffer>((yes, no) => { resolve = yes; reject = no; });
  const source = new Blob([bytes]);
  vi.spyOn(source, 'arrayBuffer').mockReturnValue(read);
  return { binary: { fingerprintSha256, source }, metadata, resolve: () => resolve(bytes.buffer), reject };
};

describe('loaded-source binding and document-lifetime font hydration', () => {
  it('publishes source/assets in the existing outer batch; rebind makes no canonical writes', () => {
    const { session, binding, port } = setup();
    const notify = vi.fn(); session.subscribe(notify);
    const blob = new Blob(['image']);
    const metadata = { name: 'new', width: 20, height: 10, contentType: 'image/png' };
    session.runPublication(() => {
      binding.publishMetadata(metadata); binding.publishSource('new', blob, 'identity');
      binding.publishBinaryAssets([], []);
    });
    expect(notify).toHaveBeenCalledOnce();
    const snapshot = session.getSnapshot();
    binding.presentExisting();
    expect(session.getSnapshot()).toBe(snapshot);
    expect(notify).toHaveBeenCalledOnce();
    expect(port.metadata).toHaveBeenLastCalledWith(metadata);
    expect(port.source).toHaveBeenLastCalledWith('new', blob, 'identity');
    expect(binding.getPreservedSources()).toBe(snapshot.loadedSource.preservedSources);
    session.dispose();
  });

  it('old same-document completion cannot clear a newer pending load', async () => {
    const a = await delayedFont(), b = await delayedFont();
    const { session, document, binding, port } = setup();
    session.setDocument({ ...document, assets: { ...document.assets, fonts: [a.metadata] } });
    const disconnect = binding.connect();
    binding.publishBinaryAssets([a.binary], []);
    binding.publishBinaryAssets([b.binary], []);
    a.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(session.fontHydration.getSnapshot().pending).toBe(true);
    expect(port.fontPending).toHaveBeenLastCalledWith(true);
    b.resolve();
    await vi.waitFor(() => expect(session.fontHydration.getSnapshot().pending).toBe(false));
    expect(session.fonts.availableAssets).toHaveLength(1);
    disconnect(); session.dispose();
  });

  it.each(['complete', 'fail'] as const)('retains %s while detached and projects it on rebind', async outcome => {
    const font = await delayedFont();
    const { session, document, binding, port } = setup();
    session.setDocument({ ...document, assets: { ...document.assets, fonts: [font.metadata] } });
    const disconnect = binding.connect();
    binding.publishBinaryAssets([font.binary], []);
    disconnect(); port.fontPending.mockClear(); port.fontError.mockClear();
    if (outcome === 'complete') font.resolve(); else font.reject(new Error('Invalid embedded font'));
    await vi.waitFor(() => expect(session.fontHydration.getSnapshot().pending).toBe(false));
    expect(port.fontPending).not.toHaveBeenCalled(); expect(port.fontError).not.toHaveBeenCalled();
    const rebound = new DocumentLoadedSourceBinding(session, session.fontHydration, port);
    const stop = rebound.connect();
    port.fontError.mockClear(); // Overlay's generic before-rebind diagnostic reset.
    rebound.presentExisting();
    expect(port.fontPending).toHaveBeenLastCalledWith(false);
    if (outcome === 'fail') expect(port.fontError).toHaveBeenLastCalledWith('Invalid embedded font');
    stop(); session.dispose();
  });

  it('rebind joins an unfinished load; empty publication retires that operation', async () => {
    const font = await delayedFont();
    const { session, document, binding, port } = setup();
    session.setDocument({ ...document, assets: { ...document.assets, fonts: [font.metadata] } });
    binding.publishBinaryAssets([font.binary], []);
    const stop = binding.connect();
    expect(port.fontPending).toHaveBeenLastCalledWith(true);
    session.setDocument(document); binding.publishBinaryAssets([], []);
    await vi.waitFor(() => expect(session.fontHydration.getSnapshot().pending).toBe(false));
    font.reject(new Error('stale'));
    await Promise.resolve(); await Promise.resolve();
    expect(port.fontError).not.toHaveBeenCalled();
    stop(); session.dispose();
  });

  it('rejects stale source publication and prevents UI/registry writes after close during blob read', async () => {
    const font = await delayedFont();
    const { session, document, binding, port } = setup();
    session.setDocument({ ...document, assets: { ...document.assets, fonts: [font.metadata] } });
    binding.connect(); binding.publishBinaryAssets([font.binary], []);
    session.dispose(); port.fontPending.mockClear();
    port.isCurrent = () => false;
    expect(() => binding.publishMetadata({ name: 'x', width: 1, height: 1, contentType: 'image/png' }))
      .toThrow(/no longer current/);
    font.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(session.fonts.byteSize).toBe(0); expect(session.fonts.assets).toEqual([]);
    expect(port.fontPending).not.toHaveBeenCalled();
  });
});
