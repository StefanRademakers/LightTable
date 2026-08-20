import { createDefaultGradientPaint } from '@lighttable/paint-core';
import { describe, expect, it, vi } from 'vitest';
import { createImageDocument, type RasterLayer } from '../../../editor/document/documentTypes';
import { createRasterLayer } from '../../../editor/document/documentCommands';
import type { ReversiblePixelEdit } from '../../../editor/history/ReversiblePixelEdit';
import { executeGradientOperation, type GradientRendererPort } from './gradientOperation';

const pixelEdit = (): ReversiblePixelEdit => ({
  byteSize: 64,
  undo: () => true,
  redo: () => true,
  destroy: () => undefined
});

const renderer = (): GradientRendererPort => ({
  beginBrushStroke: vi.fn(),
  fillLayerColor: vi.fn(() => true),
  fillLayerGradient: vi.fn(() => true),
  finishPixelEdit: vi.fn(pixelEdit),
  cancelPixelEdit: vi.fn()
});

describe('executeGradientOperation', () => {
  it('writes one reversible GPU gradient to the active raster layer', () => {
    const document = createImageDocument('Gradient', 320, 180, 'fixture');
    const active = document.layers[0] as RasterLayer;
    active.locks.transparency = true;
    const gpu = renderer();
    const paint = createDefaultGradientPaint('pixel-gradient', 'document');

    const result = executeGradientOperation(document, gpu, 'pixels', paint, 0.7, 'multiply');

    expect(result.ok).toBe(true);
    expect(gpu.fillLayerGradient).toHaveBeenCalledWith(
      active.id,
      'pixels',
      paint,
      0.7,
      'multiply',
      true
    );
    if (result.ok) {
      expect((result.document.layers[0] as RasterLayer).pixelRevision).toBe(1);
      expect(result.pixelEdit.byteSize).toBe(64);
    }
  });

  it('rejects a missing mask before opening a pixel transaction', () => {
    const document = createImageDocument('Gradient', 16, 12, 'fixture');
    const gpu = renderer();
    const result = executeGradientOperation(
      document,
      gpu,
      'mask',
      createDefaultGradientPaint('mask-gradient'),
      1,
      'normal'
    );
    expect(result).toMatchObject({ ok: false });
    expect(gpu.beginBrushStroke).not.toHaveBeenCalled();
  });

  it('targets a non-active raster explicitly and rejects locked pixels', () => {
    const initial = createImageDocument('Explicit Gradient', 32, 24, 'fixture');
    const original = initial.layers[0] as RasterLayer;
    const document = createRasterLayer(initial, 'Active paint layer');
    const paint = createDefaultGradientPaint('explicit-gradient', 'document');
    const gpu = renderer();
    expect(executeGradientOperation(document, gpu, 'pixels', paint, 1, 'normal', original.id))
      .toMatchObject({ ok: true, layerId: original.id, channel: 'pixels' });
    expect(gpu.beginBrushStroke).toHaveBeenCalledWith(original, 'pixels');

    const locked = { ...original, locks: { ...original.locks, pixels: true } };
    const lockedDocument = { ...document,
      layers: document.layers.map((layer) => layer.id === original.id ? locked : layer) };
    const lockedGpu = renderer();
    expect(executeGradientOperation(lockedDocument, lockedGpu, 'pixels', paint, 1, 'normal', original.id))
      .toMatchObject({ ok: false, message: expect.stringContaining('Unlock') });
    expect(lockedGpu.beginBrushStroke).not.toHaveBeenCalled();
  });

  it('cancels the transaction when the GPU target is unavailable', () => {
    const document = createImageDocument('Gradient', 16, 12, 'fixture');
    const gpu = renderer();
    vi.mocked(gpu.fillLayerGradient).mockReturnValue(false);
    const result = executeGradientOperation(
      document,
      gpu,
      'pixels',
      createDefaultGradientPaint('failed-gradient'),
      1,
      'normal'
    );
    expect(result).toMatchObject({ ok: false });
    expect(gpu.cancelPixelEdit).toHaveBeenCalledOnce();
  });
});
