import { describe, expect, it, vi } from 'vitest';
import { DocumentSession, type DocumentSessionId } from '../../application/documents/documentSession';
import { createEditorDocumentFontRuntime } from './useEditorDocumentFonts';

describe('document font runtime lifetime adapter', () => {
  it('keeps embedded resources through StrictMode replay and releases the exact retired runtime', async () => {
    const a = createEditorDocumentFontRuntime();
    const releaseFirst = a.connect(); releaseFirst();
    const releaseReplay = a.connect();
    await Promise.resolve();
    expect(() => a.registry.subscribeAvailability(() => undefined)).not.toThrow();
    releaseReplay();
    const b = createEditorDocumentFontRuntime(); const releaseB = b.connect();
    await Promise.resolve();
    expect(() => a.registry.subscribeAvailability(() => undefined)).toThrow(/disposed/);
    expect(() => b.registry.subscribeAvailability(() => undefined)).not.toThrow();
    releaseB(); await Promise.resolve();
  });

  it('resets embedded source resources without replacing ports or losing listeners', () => {
    const runtime = createEditorDocumentFontRuntime();
    const registry = runtime.registry;
    const notify = vi.fn(); const unsubscribe = runtime.subscribe(notify);
    runtime.resetForOpen();
    expect(runtime.registry).toBe(registry);
    expect(notify).toHaveBeenCalledOnce();
    expect(runtime.hydration.getSnapshot()).toEqual({ pending: false, error: null });
    unsubscribe(); runtime.hydration.dispose(); registry.dispose();
  });

  it('never disposes or resets document-owned resources on presentation retirement', async () => {
    const session = new DocumentSession({ id: 'font-runtime' as DocumentSessionId,
      source: { id: 'source', name: 'source', mediaType: 'image/png' } });
    const runtime = createEditorDocumentFontRuntime(session);
    const reset = vi.spyOn(session.fonts, 'reset');
    const dispose = vi.spyOn(session.fonts, 'dispose');
    const release = runtime.connect(); runtime.resetForOpen(); release();
    await Promise.resolve();
    expect(reset).not.toHaveBeenCalled(); expect(dispose).not.toHaveBeenCalled();
    expect(runtime.hydration).toBe(session.fontHydration);
    session.dispose(); expect(dispose).toHaveBeenCalledOnce();
  });
});
