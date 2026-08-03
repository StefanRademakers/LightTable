import type { TextEditingOverlay } from '@lighttable/text-rendering';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TextEditingOverlayBackend } from './TextEditingOverlayBackend';

beforeEach(() => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1 });
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
});

const fixture = () => {
  const buffers: Array<{ label: string; destroy: ReturnType<typeof vi.fn> }> = [];
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
  const device = {
    createBindGroupLayout: vi.fn(() => ({})), createPipelineLayout: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})), createRenderPipeline: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createBuffer: vi.fn(({ label }: { label: string }) => {
      const buffer = { label, destroy: vi.fn() }; buffers.push(buffer); return buffer;
    }),
    queue: { writeBuffer: vi.fn(), onSubmittedWorkDone: vi.fn(async () => undefined) }
  };
  return { device, buffers, pass, encoder: { beginRenderPass: vi.fn(() => pass) } };
};

const overlay: TextEditingOverlay = {
  layerId: 'text', resourceKey: 'text:layout:selection',
  quads: [{
    role: 'selection', color: [0.1, 0.2, 0.3, 0.4],
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
  }],
  lines: [
    { role: 'caret', start: { x: 10, y: 0 }, end: { x: 10, y: 10 }, widthPx: 1, color: [1, 1, 1, 1] },
    { role: 'baseline', start: { x: 0, y: 9 }, end: { x: 10, y: 9 }, widthPx: 1, color: [0, 0.5, 1, 1] }
  ]
};

describe('TextEditingOverlayBackend', () => {
  it('reuses geometry across viewport and caret-blink-only submissions', async () => {
    const { device, buffers, pass, encoder } = fixture();
    const backend = new TextEditingOverlayBackend(device as unknown as GPUDevice);
    const target = {
      colorView: {} as GPUTextureView, format: 'rgba16float' as GPUTextureFormat,
      width: 800, height: 600,
      documentToViewport: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
    };
    backend.encode(encoder as unknown as GPUCommandEncoder, overlay, target, true);
    backend.encode(encoder as unknown as GPUCommandEncoder, overlay, {
      ...target, documentToViewport: { ...target.documentToViewport, tx: 20 }
    }, false);
    expect(buffers.filter(({ label }) => label.includes('overlay quads'))).toHaveLength(1);
    expect(buffers.filter(({ label }) => label.includes('overlay caret'))).toHaveLength(1);
    expect(buffers.filter(({ label }) => label.includes('overlay lines'))).toHaveLength(1);
    expect(pass.draw).toHaveBeenCalledTimes(5);
    expect(backend.cacheMetrics()).toEqual({ entries: 1 });
    await backend.notifySubmitted();
    expect(buffers.filter(({ label }) => label === 'LightTable text overlay settings')
      .every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
    backend.dispose();
  });

  it('uses alpha blending and releases cached GPU buffers', () => {
    const { device, buffers, encoder } = fixture();
    const backend = new TextEditingOverlayBackend(device as unknown as GPUDevice);
    backend.encode(encoder as unknown as GPUCommandEncoder, overlay, {
      colorView: {} as GPUTextureView, format: 'bgra8unorm' as GPUTextureFormat,
      width: 10, height: 10,
      documentToViewport: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
    });
    const pipeline = (device.createRenderPipeline.mock.calls as unknown as Array<[
      { fragment: { targets: Array<{ blend: { color: unknown } }> } }
    ]>)[0]![0];
    expect(pipeline.fragment.targets[0].blend.color)
      .toEqual({ srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' });
    backend.dispose();
    expect(buffers.filter(({ label }) => label.includes('LightTable text overlay '))
      .every(({ destroy }) => destroy.mock.calls.length === 1)).toBe(true);
  });
});
