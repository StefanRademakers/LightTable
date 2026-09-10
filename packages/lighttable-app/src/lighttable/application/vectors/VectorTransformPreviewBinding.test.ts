import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, createVectorLayer } from '../../editor/document/documentTypes';
import { captureVectorTransformPreviewBinding } from './VectorTransformPreviewBinding';

describe('VectorTransformPreviewBinding', () => {
  it('invalidates mutation on document, renderer or generation replacement', () => {
    let document = createImageDocument('Vector', 64, 64, 'source');
    let generation = 3;
    let renderer = {
      setVectorSelectionPreviewTransform: vi.fn(),
      updateSemanticLayerTransform: vi.fn(() => true),
      cancelSemanticLayerTransform: vi.fn(() => true),
      setVectorContentPreviews: vi.fn(() => true),
      clearVectorContentPreviews: vi.fn(() => true)
    };
    const source = {
      getDocument: () => document,
      getRenderer: () => renderer,
      getRendererGeneration: () => generation
    };
    const layer = createVectorLayer([]);
    const binding = captureVectorTransformPreviewBinding(source);
    expect(binding?.isCurrent()).toBe(true);
    expect(binding?.setElements([layer], { a: 1, b: 0, c: 0, d: 1, tx: 2, ty: 3 })).toBe(true);

    document = { ...document };
    expect(binding?.isCurrent()).toBe(false);
    expect(binding?.setElements([layer], { a: 1, b: 0, c: 0, d: 1, tx: 4, ty: 5 })).toBe(false);

    const openingRenderer = renderer;
    renderer = { ...renderer };
    generation += 1;
    expect(binding?.clearElements()).toBe(false);
    expect(openingRenderer.clearVectorContentPreviews).not.toHaveBeenCalled();
    expect(renderer.clearVectorContentPreviews).not.toHaveBeenCalled();
  });

  it('clears the admitted renderer after canonical publication without requiring the old document', () => {
    let document = createImageDocument('Vector', 64, 64, 'source');
    const renderer = {
      setVectorSelectionPreviewTransform: vi.fn(),
      updateSemanticLayerTransform: vi.fn(() => true),
      cancelSemanticLayerTransform: vi.fn(() => true),
      setVectorContentPreviews: vi.fn(() => true),
      clearVectorContentPreviews: vi.fn(() => true)
    };
    const binding = captureVectorTransformPreviewBinding({
      getDocument: () => document,
      getRenderer: () => renderer,
      getRendererGeneration: () => 7
    });
    document = { ...document };
    expect(binding?.isCurrent()).toBe(false);
    expect(binding?.clearElements()).toBe(true);
    expect(renderer.setVectorSelectionPreviewTransform).toHaveBeenLastCalledWith(null);
    expect(renderer.clearVectorContentPreviews).toHaveBeenCalledOnce();
  });

  it('rolls back both element-preview legs when content publication throws', () => {
    const document = createImageDocument('Vector', 64, 64, 'source');
    const layer = createVectorLayer([]);
    const renderer = {
      setVectorSelectionPreviewTransform: vi.fn(),
      updateSemanticLayerTransform: vi.fn(() => true),
      cancelSemanticLayerTransform: vi.fn(() => true),
      setVectorContentPreviews: vi.fn(() => { throw new Error('device lost'); }),
      clearVectorContentPreviews: vi.fn(() => true)
    };
    const binding = captureVectorTransformPreviewBinding({
      getDocument: () => document,
      getRenderer: () => renderer,
      getRendererGeneration: () => 2
    });

    expect(binding?.setElements(
      [layer],
      { a: 1, b: 0, c: 0, d: 1, tx: 4, ty: 5 }
    )).toBe(false);
    expect(renderer.setVectorSelectionPreviewTransform).toHaveBeenLastCalledWith(null);
    expect(renderer.clearVectorContentPreviews).toHaveBeenCalledOnce();
  });

  it('attempts every cleanup leg and contains cleanup exceptions', () => {
    const document = createImageDocument('Vector', 64, 64, 'source');
    const renderer = {
      setVectorSelectionPreviewTransform: vi.fn(() => { throw new Error('overlay cleanup'); }),
      updateSemanticLayerTransform: vi.fn(() => true),
      cancelSemanticLayerTransform: vi.fn(() => true),
      setVectorContentPreviews: vi.fn(() => true),
      clearVectorContentPreviews: vi.fn(() => { throw new Error('content cleanup'); })
    };
    const binding = captureVectorTransformPreviewBinding({
      getDocument: () => document,
      getRenderer: () => renderer,
      getRendererGeneration: () => 9
    });

    expect(() => binding?.clearElements()).not.toThrow();
    expect(binding?.clearElements()).toBe(false);
    expect(renderer.clearVectorContentPreviews).toHaveBeenCalledTimes(2);
  });
});
