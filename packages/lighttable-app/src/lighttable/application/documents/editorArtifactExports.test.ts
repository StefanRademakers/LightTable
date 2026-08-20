import { describe, expect, it, vi } from 'vitest';
import { createImageDocument } from '../../editor/document/documentTypes';
import { exportEditorPreviewArtifact } from './editorArtifactExports';

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
});
