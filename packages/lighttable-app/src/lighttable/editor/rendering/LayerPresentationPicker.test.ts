import { describe, expect, it, vi } from 'vitest';
import { addLayerMask, setLayerMaskTransform } from '../document/documentCommands';
import { createImageDocument } from '../document/documentTypes';
import type { LayerRuntimeStore } from './LayerRuntimeStore';
import type { LayerStyleRenderer } from './LayerStyleRenderer';
import { LayerPresentationPicker } from './LayerPresentationPicker';
import type { TextLayerRenderer } from '../../text/rendering/TextLayerRenderer';
import type { TextLayerRenderCoordinator } from '../../text/rendering/TextLayerRenderCoordinator';

describe('LayerPresentationPicker', () => {
  it('does not inspect masks after source bounds reject the point', async () => {
    const source = createImageDocument('Mask broad phase', 10, 10, 'asset');
    const layerId = source.activeLayerId!;
    const document = addLayerMask(source, layerId);
    const maskTexture = vi.fn(() => ({}) as GPUTexture);
    const picker = new LayerPresentationPicker({
      device: {} as GPUDevice,
      layers: {
        raster: () => ({ texture: {} as GPUTexture, width: 10, height: 10 }),
        derivedPreview: () => null,
        maskTexture
      } as unknown as LayerRuntimeStore,
      styles: { cachedPresentation: () => null } as unknown as LayerStyleRenderer,
      texts: {} as TextLayerRenderer,
      textCoordinator: {} as TextLayerRenderCoordinator
    });

    await expect(picker.pickTopLayerAtPoint(
      document, [layerId], { x: 50, y: 50 }
    )).resolves.toBeNull();
    expect(maskTexture).not.toHaveBeenCalled();
  });

  it('rejects an otherwise opaque layer outside its independently transformed mask', async () => {
    const source = createImageDocument('Mask pick', 100, 100, 'asset');
    const layerId = source.activeLayerId!;
    const document = setLayerMaskTransform(
      addLayerMask(source, layerId),
      layerId,
      { a: 1, b: 0, c: 0, d: 1, tx: 50, ty: 0 }
    );
    const picker = new LayerPresentationPicker({
      device: {} as GPUDevice,
      layers: {
        raster: () => null,
        derivedPreview: () => null,
        maskTexture: () => ({}) as GPUTexture
      } as unknown as LayerRuntimeStore,
      styles: { cachedPresentation: () => null } as unknown as LayerStyleRenderer,
      texts: {} as TextLayerRenderer,
      textCoordinator: {} as TextLayerRenderCoordinator
    });

    await expect(picker.pickTopLayerAtPoint(
      document,
      [layerId],
      { x: 10, y: 10 },
      new Set([layerId])
    )).resolves.toBeNull();
  });
});
