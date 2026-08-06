import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnchor, createSubpath, createVectorPath } from '@lighttable/vector-core';
import { realizeVectorPath } from '@lighttable/vector-rendering';
import { VectorFillBackend } from './VectorFillBackend';

beforeEach(() => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 });
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, VERTEX: 4 });
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_SRC: 4 });
});

const fixture = () => {
  const destroyed: string[] = [];
  const buffers: { label: string; destroy: ReturnType<typeof vi.fn> }[] = [];
  const textures: { descriptor: GPUTextureDescriptor; destroy: ReturnType<typeof vi.fn>; view: GPUTextureView }[] = [];
  const pass = {
    setBindGroup: vi.fn(),
    setPipeline: vi.fn(),
    setVertexBuffer: vi.fn(),
    setStencilReference: vi.fn(),
    setScissorRect: vi.fn(),
    draw: vi.fn(),
    end: vi.fn()
  };
  const device = {
    createBindGroupLayout: vi.fn(() => ({ id: 'layout' })),
    createPipelineLayout: vi.fn(() => ({ id: 'pipeline-layout' })),
    createShaderModule: vi.fn(() => ({ id: 'shader' })),
    createRenderPipeline: vi.fn((descriptor: GPURenderPipelineDescriptor) => ({
      id: 'pipeline',
      label: descriptor.label
    })),
    createBindGroup: vi.fn(() => ({ id: 'bind-group' })),
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      const view = {} as GPUTextureView;
      const texture = {
        descriptor,
        view,
        createView: vi.fn(() => view),
        destroy: vi.fn(() => destroyed.push(String(descriptor.label)))
      };
      textures.push(texture);
      return texture;
    }),
    createBuffer: vi.fn(({ label }: { label: string }) => {
      const buffer = { label, destroy: vi.fn(() => destroyed.push(label)) };
      buffers.push(buffer);
      return buffer;
    }),
    queue: {
      writeBuffer: vi.fn(),
      onSubmittedWorkDone: vi.fn(async () => undefined)
    }
  };
  const encoder = { beginRenderPass: vi.fn(() => pass) };
  return { device, encoder, pass, buffers, textures, destroyed };
};

const pathFixture = () => createVectorPath('p', 'Shape', [createSubpath('s', [
  createAnchor('a', { x: 0, y: 0 }),
  createAnchor('b', { x: 100, y: 0 }),
  createAnchor('c', { x: 0, y: 100 })
], true)]);

describe('VectorFillBackend', () => {
  it('creates a four-sample render target resolved into the reusable vector texture', () => {
    const { device, textures, destroyed } = fixture();
    const backend = new VectorFillBackend(device as unknown as GPUDevice);

    const surface = backend.createSurface(320, 180, 'rgba16float', true);

    expect(surface.sampleCount).toBe(4);
    expect(textures.map(({ descriptor }) => ({
      label: descriptor.label,
      sampleCount: descriptor.sampleCount ?? 1
    }))).toEqual([
      { label: 'LightTable vector color surface', sampleCount: 1 },
      { label: 'LightTable vector multisample color surface', sampleCount: 4 },
      { label: 'LightTable vector stencil surface', sampleCount: 4 }
    ]);
    expect(surface.renderColor).not.toBe(surface.color);

    surface.dispose();
    expect(destroyed).toEqual([
      'LightTable vector color surface',
      'LightTable vector multisample color surface',
      'LightTable vector stencil surface'
    ]);
    backend.dispose();
  });

  it('compiles lazily and reuses geometry by revision key', async () => {
    const { device, encoder, pass, buffers, destroyed } = fixture();
    const backend = new VectorFillBackend(device as unknown as GPUDevice);
    expect(device.createRenderPipeline).not.toHaveBeenCalled();
    const path = pathFixture();
    const realized = realizeVectorPath(path, 0.25);
    const target = {
      colorView: {} as GPUTextureView,
      resolveView: null,
      stencilView: {} as GPUTextureView,
      format: 'rgba16float' as GPUTextureFormat,
      sampleCount: 1,
      origin: { x: 0, y: 0 },
      width: 200,
      height: 200
    };

    expect(backend.encodeFill(encoder as unknown as GPUCommandEncoder, path, realized, target)).toBe(true);
    expect(backend.encodeFill(encoder as unknown as GPUCommandEncoder, path, realized, target)).toBe(true);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(4);
    expect(device.createRenderPipeline).toHaveBeenNthCalledWith(1, expect.objectContaining({
      fragment: expect.objectContaining({
        entryPoint: 'stencilFragment',
        targets: [{ format: 'rgba16float', writeMask: 0 }]
      })
    }));
    expect(buffers.filter(({ label }) => label.startsWith('LightTable vector geometry'))).toHaveLength(1);
    expect(pass.draw).toHaveBeenCalledTimes(4);
    expect(backend.cacheMetrics()).toMatchObject({ entries: 1, hits: 1, misses: 1 });

    await backend.notifySubmitted();
    expect(destroyed.filter((label) => label === 'LightTable vector draw settings')).toHaveLength(2);
    backend.dispose();
    expect(destroyed.some((label) => label.startsWith('LightTable vector geometry'))).toBe(true);
  });

  it('renders and caches union-safe stroke geometry independently from fills', async () => {
    const { device, encoder, pass, buffers } = fixture();
    const backend = new VectorFillBackend(device as unknown as GPUDevice);
    const source = pathFixture();
    const path = {
      ...source,
      style: {
        ...source.style,
        fill: null,
        stroke: {
          paint: { type: 'solid' as const, color: [0.25, 0.5, 1, 0.75] as const },
          width: 8,
          cap: 'round' as const,
          join: 'round' as const,
          miterLimit: 4,
          dash: [12, 6],
          dashOffset: 2
        }
      },
      styleRevision: 1
    };
    const realized = realizeVectorPath(path, 0.25);
    const target = {
      colorView: {} as GPUTextureView,
      resolveView: null,
      stencilView: {} as GPUTextureView,
      format: 'rgba16float' as GPUTextureFormat,
      sampleCount: 1,
      origin: { x: 0, y: 0 },
      width: 200,
      height: 200
    };

    expect(backend.encodeStroke(encoder as unknown as GPUCommandEncoder, path, realized, target)).toBe(true);
    expect(backend.encodeStroke(encoder as unknown as GPUCommandEncoder, path, realized, target)).toBe(true);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(4);
    expect(pass.setPipeline).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: 'pipeline',
      label: 'LightTable vector stroke union stencil'
    }));
    const strokeUnionDescriptor = device.createRenderPipeline.mock.calls[2]?.[0] as GPURenderPipelineDescriptor;
    expect(strokeUnionDescriptor.label).toBe('LightTable vector stroke union stencil');
    expect(strokeUnionDescriptor.depthStencil?.stencilFront?.passOp).toBe('increment-clamp');
    expect(strokeUnionDescriptor.depthStencil?.stencilBack?.passOp).toBe('increment-clamp');
    expect(buffers.filter(({ label }) => label.includes('stroke:p:0'))).toHaveLength(1);
    expect(pass.draw).toHaveBeenCalledTimes(4);
    expect(backend.cacheMetrics()).toMatchObject({ entries: 1, hits: 1, misses: 1 });
    expect(backend.invalidatePath('p')).toBe(1);
    await backend.notifySubmitted();
    backend.dispose();
  });

  it('clips vector draws to a bounded target-space scissor rectangle', () => {
    const { device, encoder, pass } = fixture();
    const backend = new VectorFillBackend(device as unknown as GPUDevice);
    const path = pathFixture();
    const realized = realizeVectorPath(path, 0.25);
    const encoded = backend.encodeFill(encoder as unknown as GPUCommandEncoder, path, realized, {
      colorView: {} as GPUTextureView,
      resolveView: null,
      stencilView: {} as GPUTextureView,
      format: 'rgba16float', sampleCount: 1,
      origin: { x: 100, y: 50 }, width: 200, height: 100,
      clip: { x: 90.2, y: 60.25, width: 250.1, height: 20.1 }
    });

    expect(encoded).toBe(true);
    expect(pass.setScissorRect).toHaveBeenCalledWith(0, 10, 200, 21);

    const outside = backend.encodeFill(encoder as unknown as GPUCommandEncoder, path, realized, {
      colorView: {} as GPUTextureView,
      resolveView: null,
      stencilView: {} as GPUTextureView,
      format: 'rgba16float', sampleCount: 1,
      origin: { x: 100, y: 50 }, width: 200, height: 100,
      clip: { x: 0, y: 0, width: 10, height: 10 }
    });
    expect(outside).toBe(false);
    expect(encoder.beginRenderPass).toHaveBeenCalledTimes(1);
    backend.dispose();
  });

  it('does not alias stroke meshes with different widths at the same path revision', () => {
    const { device, encoder, buffers } = fixture();
    const backend = new VectorFillBackend(device as unknown as GPUDevice);
    const source = pathFixture();
    const stroked = (width: number) => ({
      ...source,
      style: {
        ...source.style,
        fill: null,
        stroke: {
          paint: { type: 'solid' as const, color: [1, 1, 1, 1] as const },
          width, cap: 'butt' as const, join: 'miter' as const,
          miterLimit: 4, dash: [], dashOffset: 0
        }
      }
    });
    const target = {
      colorView: {} as GPUTextureView, resolveView: null,
      stencilView: {} as GPUTextureView, format: 'rgba16float' as GPUTextureFormat,
      sampleCount: 1, origin: { x: 0, y: 0 }, width: 200, height: 200
    };
    const narrow = stroked(1);
    const wide = stroked(8);

    backend.encodeStroke(encoder as unknown as GPUCommandEncoder, narrow, realizeVectorPath(narrow, 0.25), target);
    backend.encodeStroke(encoder as unknown as GPUCommandEncoder, wide, realizeVectorPath(wide, 0.25), target);

    expect(buffers.filter(({ label }) => label.startsWith('LightTable vector geometry stroke:')))
      .toHaveLength(2);
    backend.dispose();
  });

  it('multiplies stroke-only opacity without fading the fill draw', () => {
    const { device, encoder } = fixture();
    const backend = new VectorFillBackend(device as unknown as GPUDevice);
    const path = pathFixture();
    path.style.opacity = 0.5;
    path.style.stroke = {
      paint: { type: 'solid', color: [1, 0.5, 0.25, 0.5] },
      opacity: 0.4,
      width: 10,
      cap: 'round', join: 'round', miterLimit: 4, dash: [], dashOffset: 0
    };
    const target = {
      colorView: {} as GPUTextureView, resolveView: null,
      stencilView: {} as GPUTextureView, format: 'rgba16float' as GPUTextureFormat,
      sampleCount: 1, origin: { x: 0, y: 0 }, width: 200, height: 200
    };

    backend.encodeFill(encoder as unknown as GPUCommandEncoder, path, realizeVectorPath(path, 0.25), target);
    backend.encodeStroke(encoder as unknown as GPUCommandEncoder, path, realizeVectorPath(path, 0.25), target);
    const settings = device.queue.writeBuffer.mock.calls
      .map((call) => call[2])
      .filter((value): value is Float32Array => value instanceof Float32Array && value.length === 28);

    expect(settings).toHaveLength(2);
    expect(settings[0]![15]).toBeCloseTo(0.5);
    expect(settings[1]![15]).toBeCloseTo(0.1);
    backend.dispose();
  });

  it('uploads and reuses a shared gradient LUT with object-bounds mapping', () => {
    const { device, encoder, buffers } = fixture();
    const backend = new VectorFillBackend(device as unknown as GPUDevice);
    const source = pathFixture();
    const path = {
      ...source,
      style: {
        ...source.style,
        fill: {
          kind: 'gradient' as const,
          asset: {
            id: 'sunset', name: 'Sunset', type: 'solid' as const, smoothness: 1,
            colorStops: [
              { id: 'red', position: 0, midpoint: 0.5, color: { r: 1, g: 0, b: 0, a: 1 } },
              { id: 'blue', position: 1, midpoint: 0.5, color: { r: 0, g: 0, b: 1, a: 1 } }
            ],
            opacityStops: [
              { id: 'opaque-a', position: 0, midpoint: 0.5, opacity: 1 },
              { id: 'opaque-b', position: 1, midpoint: 0.5, opacity: 1 }
            ],
            roughness: 0, seed: 0
          },
          shape: 'linear' as const, coordinateSpace: 'object-bounds' as const,
          transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
          reverse: false, dither: true, interpolation: 'perceptual' as const
        }
      }
    };
    const target = {
      colorView: {} as GPUTextureView, resolveView: null,
      stencilView: {} as GPUTextureView, format: 'rgba16float' as GPUTextureFormat,
      sampleCount: 1, origin: { x: 0, y: 0 }, width: 200, height: 200
    };

    const geometry = realizeVectorPath(path, 0.25);
    expect(backend.encodeFill(encoder as unknown as GPUCommandEncoder, path, geometry, target)).toBe(true);
    expect(backend.encodeFill(encoder as unknown as GPUCommandEncoder, path, geometry, target)).toBe(true);
    expect(buffers.filter(({ label }) => label.includes('gradient LUT sunset'))).toHaveLength(1);
    const writes = device.queue.writeBuffer.mock.calls
      .map((call) => call[2])
      .filter((value): value is Float32Array => value instanceof Float32Array);
    expect(writes.some((value) => value.length === 256 * 4)).toBe(true);
    const settings = writes.find((value) => value.length === 28);
    expect(settings?.slice(16, 23)).toEqual(new Float32Array([
      0.01, 0, 0, 0, 0, 0.01, 0
    ]));
    backend.dispose();
  });
});
