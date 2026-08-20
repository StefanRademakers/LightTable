import { describe, expect, it, vi } from 'vitest';
import {
  createImageDocument,
  type RasterLayer,
  type RasterMask
} from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import { createRasterLayer } from '../../../editor/document/documentCommands';
import {
  executeFillOperation,
  srgbHexToLinearRgb,
  type FillRendererPort
} from './fillOperation';

const pixelEdit = (): ReversiblePixelEdit => ({
  byteSize: 32,
  undo: () => true,
  redo: () => true,
  destroy: () => undefined
});

const createFixture = (mask: RasterMask | null = null) => {
  const document = createImageDocument('Fixture', 320, 180, 'fixture');
  const layer = document.layers[0] as RasterLayer;
  const raster = { ...layer, mask };
  return {
    document: { ...document, layers: [raster] },
    layer: raster
  };
};

const createRenderer = (): FillRendererPort => ({
  beginBrushStroke: vi.fn(),
  fillLayerColor: vi.fn(() => true),
  finishPixelEdit: vi.fn(pixelEdit),
  cancelPixelEdit: vi.fn()
});

describe('executeFillOperation', () => {
  it('converts encoded sRGB colors to linear channels', () => {
    expect(srgbHexToLinearRgb('#000000')).toEqual([0, 0, 0]);
    expect(srgbHexToLinearRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(srgbHexToLinearRgb('#808080')?.[0]).toBeCloseTo(0.21586, 5);
    expect(srgbHexToLinearRgb('red')).toBeNull();
  });

  it('fills raster pixels and preserves locked transparency', () => {
    const fixture = createFixture();
    fixture.layer.locks.transparency = true;
    const renderer = createRenderer();
    const result = executeFillOperation(fixture.document, renderer, 'pixels', '#ff0000');
    expect(result.ok).toBe(true);
    expect(renderer.fillLayerColor).toHaveBeenCalledWith(
      fixture.layer.id,
      'pixels',
      [1, 0, 0],
      true,
      1
    );
    if (result.ok) {
      expect((result.document.layers[0] as RasterLayer).pixelRevision).toBe(1);
      expect(result.targetLabel).toBe('Background');
    }
  });

  it('can preserve transparency for one fill without changing the layer lock', () => {
    const fixture = createFixture();
    const renderer = createRenderer();
    const result = executeFillOperation(
      fixture.document,
      renderer,
      'pixels',
      '#ff0000',
      { preserveTransparency: true }
    );
    expect(result.ok).toBe(true);
    expect(renderer.fillLayerColor).toHaveBeenCalledWith(
      fixture.layer.id,
      'pixels',
      [1, 0, 0],
      true,
      1
    );
    expect(fixture.layer.locks.transparency).toBe(false);
  });

  it('uses an explicit non-active raster target and rejects its pixel lock', () => {
    const initial = createImageDocument('Explicit Fill', 40, 30, 'asset');
    const original = initial.layers[0] as RasterLayer;
    const document = createRasterLayer(initial, 'Active paint layer');
    const renderer = createRenderer();
    const filled = executeFillOperation(document, renderer, 'pixels', '#ffffff', {
      layerId: original.id
    });
    expect(filled).toMatchObject({ ok: true, layerId: original.id });
    expect(renderer.beginBrushStroke).toHaveBeenCalledWith(original, 'pixels');

    const lockedOriginal = { ...original, locks: { ...original.locks, pixels: true } };
    const lockedDocument = { ...document,
      layers: document.layers.map((layer) => layer.id === original.id ? lockedOriginal : layer) };
    const lockedRenderer = createRenderer();
    expect(executeFillOperation(lockedDocument, lockedRenderer, 'pixels', '#ffffff', {
      layerId: original.id
    })).toMatchObject({ ok: false, code: 'invalid-target' });
    expect(lockedRenderer.beginBrushStroke).not.toHaveBeenCalled();
  });

  it('clears selected raster pixels by writing transparent premultiplied color', () => {
    const fixture = createFixture();
    const renderer = createRenderer();

    const result = executeFillOperation(
      fixture.document,
      renderer,
      'pixels',
      '#000000',
      { opacity: 0 }
    );

    expect(result.ok).toBe(true);
    expect(renderer.fillLayerColor).toHaveBeenCalledWith(
      fixture.layer.id,
      'pixels',
      [0, 0, 0],
      false,
      0
    );
  });

  it('does not clear pixels through transparency or pixel locks', () => {
    const fixture = createFixture();
    fixture.layer.locks.transparency = true;
    const renderer = createRenderer();

    const result = executeFillOperation(
      fixture.document,
      renderer,
      'pixels',
      '#000000',
      { opacity: 0 }
    );

    expect(result).toMatchObject({ ok: false, code: 'invalid-target' });
    expect(renderer.beginBrushStroke).not.toHaveBeenCalled();
  });

  it('requires and revisions an explicit mask target', () => {
    const mask: RasterMask = {
      id: 'mask',
      enabled: true,
      linked: true,
      transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      density: 1,
      feather: 0,
      revision: 0,
      pixelRevision: 0,
      dirtyBounds: null
    };
    const fixture = createFixture(mask);
    const result = executeFillOperation(fixture.document, createRenderer(), 'mask', '#ffffff');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.document.layers[0] as RasterLayer).mask?.pixelRevision).toBe(1);
      expect(result.targetLabel).toBe('Mask');
    }
  });

  it('returns typed target failures without opening a renderer transaction', () => {
    const fixture = createFixture();
    const renderer = createRenderer();
    const result = executeFillOperation(fixture.document, renderer, 'mask', '#ffffff');
    expect(result).toMatchObject({ ok: false, code: 'invalid-target' });
    expect(renderer.beginBrushStroke).not.toHaveBeenCalled();
  });

  it('cancels a failed GPU transaction', () => {
    const fixture = createFixture();
    const renderer = createRenderer();
    vi.mocked(renderer.fillLayerColor).mockReturnValue(false);
    const result = executeFillOperation(fixture.document, renderer, 'pixels', '#ffffff');
    expect(result).toMatchObject({ ok: false, code: 'gpu-target-unavailable' });
    expect(renderer.cancelPixelEdit).toHaveBeenCalledOnce();
  });

  it('cancels when the renderer cannot retain an undo snapshot', () => {
    const fixture = createFixture();
    const renderer = createRenderer();
    vi.mocked(renderer.finishPixelEdit).mockReturnValue(null);
    const result = executeFillOperation(fixture.document, renderer, 'pixels', '#ffffff');
    expect(result).toMatchObject({ ok: false, code: 'undo-snapshot-unavailable' });
    expect(renderer.cancelPixelEdit).toHaveBeenCalledOnce();
  });
});
