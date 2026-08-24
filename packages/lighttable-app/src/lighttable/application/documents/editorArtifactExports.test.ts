import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { exportEditorPreviewArtifact } from './editorArtifactExports';
import type { RendererBindingToken } from '../rendering/rendererBindingToken';

describe('editor preview artifacts', () => {
  it('synchronizes the canonical snapshot and uses bounded GPU thumbnail readback', async () => {
    const document = createImageDocument('Preview', 1600, 900, 'source');
    const renderer = {
      synchronizeDocumentForExport: vi.fn(),
      exportThumbnailPng: vi.fn(async () => new Blob(['thumbnail'], { type: 'image/png' })),
      exportPng: vi.fn()
    };
    const file = await exportEditorPreviewArtifact(
      renderer as never, document, 'portrait.psd', 512
    );
    expect(renderer.synchronizeDocumentForExport).toHaveBeenCalledWith(document);
    expect(renderer.exportThumbnailPng).toHaveBeenCalledWith(512);
    expect(renderer.exportPng).not.toHaveBeenCalled();
    expect(file).toMatchObject({ name: 'portrait-preview-512.png', type: 'image/png' });
  });

  it('synchronizes before using the shared Copy Merged region readback', async () => {
    const document = createImageDocument('Preview', 1600, 900, 'source');
    const renderer = { synchronizeDocumentForExport: vi.fn(),
      exportRegionThumbnailPng: vi.fn(async () => new Blob(['region'], { type: 'image/png' })),
      exportThumbnailPng: vi.fn() };
    const region = { x: 100, y: 80, width: 400, height: 200 };
    const file = await exportEditorPreviewArtifact(
      renderer as never, document, 'portrait.psd', 256, region
    );
    expect(renderer.synchronizeDocumentForExport).toHaveBeenCalledWith(document);
    expect(renderer.exportRegionThumbnailPng).toHaveBeenCalledWith(region, 256);
    expect(renderer.exportThumbnailPng).not.toHaveBeenCalled();
    expect(file.name).toBe('portrait-region-preview-256.png');
  });

  it('rejects a preview readback completed after renderer rebinding', async () => {
    const document = createImageDocument('Preview', 1600, 900, 'source');
    let resolveReadback!: (blob: Blob) => void;
    const renderer = {
      synchronizeDocumentForExport: vi.fn(),
      exportThumbnailPng: vi.fn(() => new Promise<Blob>((resolve) => { resolveReadback = resolve; }))
    };
    let current = true;
    const binding = {
      document,
      renderer,
      rendererGeneration: 1,
      isCurrent: () => current,
      assertCurrent: (operation: string) => {
        if (!current) throw new Error(`${operation} was canceled because the document renderer changed.`);
      }
    } as RendererBindingToken<never>;
    const result = exportEditorPreviewArtifact(
      renderer as never, document, 'portrait.psd', 512, undefined, binding
    );
    current = false;
    resolveReadback(new Blob(['stale'], { type: 'image/png' }));
    await expect(result).rejects.toThrow(
      'Preview export was canceled because the document renderer changed.'
    );
  });
});
