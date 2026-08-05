import { describe, expect, it } from 'vitest';
import type { TextLayerEditingLayout } from '../../text/rendering/TextLayerRenderCoordinator';
import { projectTextEditingGeometryPreview } from './LayerDocumentRenderer';

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
