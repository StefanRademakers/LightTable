import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type LayerId } from '../../../editor/document/documentTypes';
import { pickTransformLayer } from './transformLayerPicker';

describe('pickTransformLayer', () => {
  it('offers visible drawable layers to the renderer from top to bottom', async () => {
    const bottom = { ...createImageDocument('bottom', 32, 32, 'bottom').layers[0]!, name: 'bottom' };
    const hidden = { ...createImageDocument('hidden', 32, 32, 'hidden').layers[0]!, visible: false };
    const top = { ...createImageDocument('top', 32, 32, 'top').layers[0]!, name: 'top' };
    const document = { ...createImageDocument('test', 32, 32, 'test'), layers: [bottom, hidden, top] };
    const pickTopLayerAtPoint = vi.fn(async (ids: readonly LayerId[]) => ids[1] ?? null);

    await expect(pickTransformLayer(document, { x: 4, y: 5 }, {
      pickTopLayerAtPoint
    })).resolves.toEqual({ layerId: bottom.id });
    expect(pickTopLayerAtPoint).toHaveBeenCalledWith(
      [top.id, bottom.id], { x: 4, y: 5 }, new Set()
    );
  });

  it('ignores locked layers and continues with unlocked content below', async () => {
    const bottom = createImageDocument('bottom', 32, 32, 'bottom').layers[0]!;
    const locked = {
      ...createImageDocument('locked', 32, 32, 'locked').layers[0]!,
      locks: { transparency: false, pixels: false, position: true, all: false }
    };
    const document = {
      ...createImageDocument('test', 32, 32, 'test'),
      layers: [bottom, locked]
    };
    const pickTopLayerAtPoint = vi.fn(async (ids: readonly LayerId[]) => ids[0] ?? null);

    await expect(pickTransformLayer(document, { x: 4, y: 5 }, {
      pickTopLayerAtPoint
    })).resolves.toEqual({ layerId: bottom.id });
    expect(pickTopLayerAtPoint).toHaveBeenCalledWith(
      [bottom.id], { x: 4, y: 5 }, new Set()
    );
  });
});
