import { describe, expect, it, vi } from 'vitest';
import { SelectionMaskSnapshot } from '../selection/SelectionMaskSnapshot';
import { LayerDocumentRenderer } from './LayerDocumentRenderer';

describe('LayerDocumentRenderer selection paint preview', () => {
  it('renders and mutates detached targets while committed textures stay untouched', async () => {
    const committedMask = {} as GPUTexture;
    const previewMask = {} as GPUTexture;
    const releaseCommittedLock = vi.fn();
    const stage = {
      textures: {
        active: true,
        mask: previewMask,
        ensureTargets: vi.fn(),
      },
      restore: vi.fn(() => true),
      apply: vi.fn(),
      applyOperation: vi.fn(),
      transform: vi.fn(),
      paint: vi.fn(() => true),
      capture: vi.fn(async () => SelectionMaskSnapshot.inactive(8, 6)),
      measure: vi.fn(async () => null),
      dispose: vi.fn(),
    };
    const runtime = {
      transformRasterizer: { selectionPreviewTexture: () => null },
      imageResources: { destroy: vi.fn() },
      selectionTextures: {
        active: true,
        mask: committedMask,
        beginPreviewMutation: vi.fn(() => ({ run: vi.fn(), release: releaseCommittedLock })),
      },
      createSelectionProjectionStage: vi.fn(() => stage),
    };
    const renderer = Object.create(LayerDocumentRenderer.prototype) as LayerDocumentRenderer;
    Object.assign(renderer, { runtime, selectionPaintPreview: null });
    const baseline = SelectionMaskSnapshot.inactive(8, 6);

    const preview = renderer.beginSelectionPaintPreview(baseline);
    expect(preview).not.toBeNull();
    expect(stage.restore).toHaveBeenCalledWith(baseline);
    expect(renderer.selectionMaskTexture()).toBe(previewMask);
    expect(runtime.selectionTextures.mask).toBe(committedMask);

    expect(preview!.paintSelectionDabs(
      [{ x: 2, y: 3, size: 4, pressure: 1, flowScale: 1 }], 1, 1, 'add',
    )).toBe(true);
    expect(stage.paint).toHaveBeenCalledOnce();
    expect(runtime.selectionTextures.mask).toBe(committedMask);

    preview!.release();
    expect(stage.dispose).toHaveBeenCalledOnce();
    expect(releaseCommittedLock).toHaveBeenCalledOnce();
    expect(renderer.selectionMaskTexture()).toBe(committedMask);
  });

  it('retires preview targets and their committed lock during image-resource cleanup', async () => {
    const committedMask = {} as GPUTexture;
    const previewMask = {} as GPUTexture;
    const releaseCommittedLock = vi.fn();
    const stage = {
      textures: { active: true, mask: previewMask, ensureTargets: vi.fn() },
      restore: vi.fn(() => true),
      apply: vi.fn(),
      applyOperation: vi.fn(),
      transform: vi.fn(),
      paint: vi.fn(() => true),
      capture: vi.fn(async () => SelectionMaskSnapshot.inactive(8, 6)),
      measure: vi.fn(async () => null),
      dispose: vi.fn(),
    };
    const runtime = {
      transformRasterizer: { selectionPreviewTexture: () => null },
      imageResources: { destroy: vi.fn() },
      selectionTextures: {
        active: true,
        mask: committedMask,
        beginPreviewMutation: vi.fn(() => ({ run: vi.fn(), release: releaseCommittedLock })),
      },
      createSelectionProjectionStage: vi.fn(() => stage),
    };
    const renderer = Object.create(LayerDocumentRenderer.prototype) as LayerDocumentRenderer;
    Object.assign(renderer, { runtime, selectionPaintPreview: null });
    const preview = renderer.beginSelectionPaintPreview(SelectionMaskSnapshot.inactive(8, 6))!;

    renderer.destroyImageResources();

    expect(stage.dispose).toHaveBeenCalledOnce();
    expect(releaseCommittedLock).toHaveBeenCalledOnce();
    expect(runtime.imageResources.destroy).toHaveBeenCalledOnce();
    expect(renderer.selectionMaskTexture()).toBe(committedMask);
    expect(preview.paintSelectionDabs([], 1, 1, 'add')).toBe(false);
    await expect(preview.captureSelectionSnapshot()).rejects.toThrow('preview was retired');
    expect(await preview.measureSelectionBounds()).toBeNull();

    preview.release();
    expect(stage.dispose).toHaveBeenCalledOnce();
    expect(releaseCommittedLock).toHaveBeenCalledOnce();
  });

  it('releases the committed lock when detached stage construction fails', () => {
    const releaseCommittedLock = vi.fn();
    const runtime = {
      selectionTextures: {
        beginPreviewMutation: vi.fn(() => ({ release: releaseCommittedLock })),
      },
      createSelectionProjectionStage: vi.fn(() => {
        throw new Error('allocation failed');
      }),
    };
    const renderer = Object.create(LayerDocumentRenderer.prototype) as LayerDocumentRenderer;
    Object.assign(renderer, { runtime, selectionPaintPreview: null });

    expect(() => renderer.beginSelectionPaintPreview(SelectionMaskSnapshot.inactive(8, 6)))
      .toThrow('allocation failed');
    expect(releaseCommittedLock).toHaveBeenCalledOnce();
  });

  it('releases the committed lock when failed initialization cleanup also throws', () => {
    const releaseCommittedLock = vi.fn();
    const stage = {
      textures: { ensureTargets: vi.fn() },
      restore: vi.fn(() => false),
      dispose: vi.fn(() => { throw new Error('cleanup failed'); }),
    };
    const runtime = {
      selectionTextures: {
        beginPreviewMutation: vi.fn(() => ({ release: releaseCommittedLock })),
      },
      createSelectionProjectionStage: vi.fn(() => stage),
    };
    const renderer = Object.create(LayerDocumentRenderer.prototype) as LayerDocumentRenderer;
    Object.assign(renderer, { runtime, selectionPaintPreview: null });

    expect(() => renderer.beginSelectionPaintPreview(SelectionMaskSnapshot.inactive(8, 6)))
      .toThrow('stage cleanup did not complete');
    expect(stage.dispose).toHaveBeenCalledOnce();
    expect(releaseCommittedLock).toHaveBeenCalledOnce();
  });
});
