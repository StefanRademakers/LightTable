import { describe, expect, it, vi } from 'vitest';
import { createAnchor, createSubpath, createVectorPath } from '@lighttable/vector-core';
import { realizeVectorPath } from '@lighttable/vector-rendering';
import { TextOutlineVectorBackend, tightTextOutlineBounds } from './TextOutlineVectorBackend';

const draw = () => {
  const path = createVectorPath('glyph', 'Glyph', [createSubpath('contour', [
    createAnchor('a', { x: 0, y: 0 }),
    createAnchor('b', { x: 10, y: 0 }),
    createAnchor('c', { x: 10, y: 20 })
  ], true)]);
  path.transform = { a: 2, b: 0, c: 0, d: 2, tx: 100, ty: 50 };
  return { path, geometry: realizeVectorPath(path, 0.25), runIndex: 0, glyphIndex: 0 };
};

const surface = () => ({
  color: { id: 'color' } as unknown as GPUTexture,
  renderColor: { id: 'msaa' } as unknown as GPUTexture,
  stencil: { id: 'stencil' } as unknown as GPUTexture,
  colorView: { id: 'color-view' } as unknown as GPUTextureView,
  renderColorView: { id: 'msaa-view' } as unknown as GPUTextureView,
  stencilView: { id: 'stencil-view' } as unknown as GPUTextureView,
  width: 24, height: 44, format: 'rgba16float' as GPUTextureFormat,
  sampleCount: 4, dispose: vi.fn()
});

const fixture = () => {
  const value = surface();
  const vector = {
    createSurface: vi.fn(() => value),
    encodeFill: vi.fn(() => true),
    encodeStroke: vi.fn(() => false),
    notifySubmitted: vi.fn(async () => undefined),
    cacheMetrics: vi.fn(() => ({ entries: 1 })),
    dispose: vi.fn()
  };
  const pass = { end: vi.fn() };
  const encoder = { beginRenderPass: vi.fn(() => pass) };
  const backend = new TextOutlineVectorBackend({} as GPUDevice, {
    maximumTextureDimension: 4096
  }, vector as never);
  return { backend, vector, value, encoder, pass };
};

describe('TextOutlineVectorBackend', () => {
  it('computes conservative tight source bounds without viewport state', () => {
    expect(tightTextOutlineBounds([draw()])).toEqual({ x: 98, y: 48, width: 24, height: 44 });
    const clipped = { ...draw(), clip: { x: 105, y: 55, width: 5, height: 10 } };
    expect(tightTextOutlineBounds([clipped])).toEqual({ x: 103, y: 53, width: 9, height: 14 });
  });

  it('encodes fill and stroke through one reusable vector backend and transparent surface', () => {
    const { backend, vector, value, encoder, pass } = fixture();
    const prepared = backend.encodeTight(encoder as unknown as GPUCommandEncoder, [draw()]);

    expect(vector.createSurface).toHaveBeenCalledWith(24, 44, 'rgba16float', true);
    expect(encoder.beginRenderPass).toHaveBeenCalledWith(expect.objectContaining({
      colorAttachments: [expect.objectContaining({ loadOp: 'clear', resolveTarget: value.colorView })]
    }));
    expect(pass.end).toHaveBeenCalledOnce();
    expect(vector.encodeFill).toHaveBeenCalledOnce();
    expect(vector.encodeStroke).toHaveBeenCalledOnce();
    expect(vector.encodeFill).toHaveBeenCalledWith(
      encoder, expect.anything(), expect.anything(),
      expect.objectContaining({ origin: { x: 98, y: 48 }, width: 24, height: 44 })
    );
    expect(prepared).toMatchObject({
      texture: value.color, width: 24, height: 44,
      sourceBounds: { x: 98, y: 48, width: 24, height: 44 },
      byteLength: 24 * 44 * 56
    });
    prepared?.dispose();
    expect(value.dispose).toHaveBeenCalledOnce();
  });

  it('enforces source texture dimensions and byte budgets before allocation', () => {
    const value = draw();
    value.path.transform = { ...value.path.transform, a: 1_000, d: 1_000 };
    const { backend, vector, encoder } = fixture();
    expect(() => backend.encodeTight(encoder as unknown as GPUCommandEncoder, [value]))
      .toThrow('bounded GPU texture budget');
    expect(vector.createSurface).not.toHaveBeenCalled();
  });

  it('drops the retained MSAA surface before rejecting a bounded path-text cache', () => {
    const value = draw();
    value.path.transform = { ...value.path.transform, a: 10, d: 10 };
    const created = surface();
    created.sampleCount = 1;
    const vector = {
      createSurface: vi.fn(() => created),
      encodeFill: vi.fn(() => true), encodeStroke: vi.fn(() => false),
      notifySubmitted: vi.fn(), cacheMetrics: vi.fn(), dispose: vi.fn()
    };
    const pass = { end: vi.fn() };
    const encoder = { beginRenderPass: vi.fn(() => pass) };
    const bounds = tightTextOutlineBounds([value])!;
    const singleSampleBytes = bounds.width * bounds.height * 20;
    const backend = new TextOutlineVectorBackend({} as GPUDevice, {
      maximumTextureDimension: 4096,
      maximumSourceBytes: singleSampleBytes
    }, vector as never);

    const prepared = backend.encodeTight(encoder as unknown as GPUCommandEncoder, [value]);
    expect(vector.createSurface).toHaveBeenCalledWith(
      bounds.width, bounds.height, 'rgba16float', false
    );
    expect(prepared?.byteLength).toBe(singleSampleBytes);
  });
});
