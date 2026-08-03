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
  ],
  markers: [{ role: 'frame-handle', point: { x: 10, y: 10 }, sizePx: 10 }]
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
    expect(buffers.filter(({ label }) => label.includes('overlay markers'))).toHaveLength(1);
    expect(pass.draw).toHaveBeenCalledTimes(7);
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

  it('streams changing selection geometry into reused per-layer buffers', () => {
    const { device, buffers, encoder } = fixture();
    const backend = new TextEditingOverlayBackend(device as unknown as GPUDevice);
    const target = {
      colorView: {} as GPUTextureView, format: 'rgba16float' as GPUTextureFormat,
      width: 800, height: 600,
      documentToViewport: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
    };
    backend.encode(encoder as unknown as GPUCommandEncoder, overlay, target);
    backend.encode(encoder as unknown as GPUCommandEncoder, {
      ...overlay,
      resourceKey: 'text:layout:selection-extended',
      quads: [...overlay.quads, {
        ...overlay.quads[0]!,
        points: [
          { x: 10, y: 0 }, { x: 20, y: 0 },
          { x: 20, y: 10 }, { x: 10, y: 10 }
        ]
      }]
    }, target);

    expect(buffers.filter(({ label }) => label.includes('overlay quads'))).toHaveLength(1);
    expect(buffers.filter(({ label }) => label.includes('overlay caret'))).toHaveLength(1);
    expect(buffers.filter(({ label }) => label.includes('overlay lines'))).toHaveLength(1);
    expect(buffers.filter(({ label }) => label.includes('overlay markers'))).toHaveLength(1);
    expect(backend.cacheMetrics()).toEqual({ entries: 1 });
    expect(device.queue.writeBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'LightTable text overlay quads text' }),
      0,
      expect.any(Float32Array)
    );
  });

  it('retains static path guides and markers across caret-only changes', () => {
    const { device, buffers, encoder } = fixture();
    const backend = new TextEditingOverlayBackend(device as unknown as GPUDevice);
    const target = {
      colorView: {} as GPUTextureView, format: 'rgba16float' as GPUTextureFormat,
      width: 800, height: 600,
      documentToViewport: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }
    };
    const pathOverlay: TextEditingOverlay = {
      ...overlay,
      resourceKey: 'path:caret:0',
      staticLines: [{
        role: 'path-baseline', start: { x: 0, y: 0 }, end: { x: 100, y: 0 },
        widthPx: 1, color: [0, 0.5, 1, 0.5]
      }],
      markers: [{ role: 'path-start-handle', point: { x: 0, y: 0 }, sizePx: 10 }],
      geometryKeys: {
        quads: 'selection:0', caret: 'caret:0', lines: 'dynamic:0',
        staticLines: 'path:7', markers: 'path:7'
      }
    };
    backend.encode(encoder as unknown as GPUCommandEncoder, pathOverlay, target);
    const staticWrites = () => device.queue.writeBuffer.mock.calls.filter(([buffer]) => (
      (buffer as { label?: string }).label?.includes('static lines')
    )).length;
    const initialStaticWrites = staticWrites();
    backend.encode(encoder as unknown as GPUCommandEncoder, {
      ...pathOverlay,
      resourceKey: 'path:caret:1',
      geometryKeys: { ...pathOverlay.geometryKeys, caret: 'caret:1', lines: 'dynamic:1' },
      lines: pathOverlay.lines.map((line) => line.role === 'caret'
        ? { ...line, start: { x: 20, y: 0 }, end: { x: 20, y: 10 } }
        : line)
    }, target);

    expect(staticWrites()).toBe(initialStaticWrites);
    expect(buffers.filter(({ label }) => label.includes('static lines'))).toHaveLength(1);
    expect(buffers.filter(({ label }) => label.includes('overlay markers'))).toHaveLength(1);
  });
});
