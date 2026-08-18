import { describe, expect, it, vi } from 'vitest';
import type { TextLayerEditingLayout } from '../../text/rendering/TextLayerRenderCoordinator';
import { LayerDocumentRenderer, projectTextEditingGeometryPreview } from './LayerDocumentRenderer';

describe('text editing geometry preview', () => {
  it('replaces canonical local geometry while retaining the parent transform', () => {
    const presentation = {
      localToDocument: { a: 2, b: 0, c: 0, d: 2, tx: 30, ty: 50 }
    } as TextLayerEditingLayout;
    const projected = projectTextEditingGeometryPreview(
      presentation,
      { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 },
      { a: 0, b: 1, c: -1, d: 0, tx: 40, ty: 60 }
    );
    expect(projected.localToDocument).toEqual({
      a: 0, b: 2, c: -2, d: 0, tx: 90, ty: 130
    });
    expect(projected).not.toBe(presentation);
  });
});

describe('layer document asset loading', () => {
  it('invalidates a processing suffix cached before raster upload', async () => {
    const load = vi.fn(async () => {});
    const destroyCaches = vi.fn();
    const renderer = Object.create(LayerDocumentRenderer.prototype) as {
      runtime: {
        documentAssets: { load: typeof load };
        compositor: { destroyCaches: typeof destroyCaches };
      };
      loadDocumentAssets: LayerDocumentRenderer['loadDocumentAssets'];
    };
    renderer.runtime = {
      documentAssets: { load },
      compositor: { destroyCaches }
    };
    const assets = [{}] as Parameters<LayerDocumentRenderer['loadDocumentAssets']>[0];

    await renderer.loadDocumentAssets(assets);

    expect(load).toHaveBeenCalledWith(assets);
    expect(destroyCaches).toHaveBeenCalledOnce();
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(
      destroyCaches.mock.invocationCallOrder[0]
    );
  });
});
