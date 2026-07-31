import { describe, expect, it, vi } from 'vitest';
import {
  createImageDocument,
  type RasterLayer,
  type RasterMask
} from '../../../editor/document/documentTypes';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
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
      true
    );
    if (result.ok) {
      expect((result.document.layers[0] as RasterLayer).pixelRevision).toBe(1);
      expect(result.targetLabel).toBe('Background');
    }
  });

  it('requires and revisions an explicit mask target', () => {
    const mask: RasterMask = {
      id: 'mask',
      enabled: true,
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
