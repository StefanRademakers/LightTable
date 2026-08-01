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
  const pass = {
    setBindGroup: vi.fn(),
    setPipeline: vi.fn(),
    setVertexBuffer: vi.fn(),
    setStencilReference: vi.fn(),
    draw: vi.fn(),
    end: vi.fn()
  };
  const device = {
    createBindGroupLayout: vi.fn(() => ({ id: 'layout' })),
    createPipelineLayout: vi.fn(() => ({ id: 'pipeline-layout' })),
    createShaderModule: vi.fn(() => ({ id: 'shader' })),
    createRenderPipeline: vi.fn(() => ({ id: 'pipeline' })),
    createBindGroup: vi.fn(() => ({ id: 'bind-group' })),
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
  return { device, encoder, pass, buffers, destroyed };
};

const pathFixture = () => createVectorPath('p', 'Shape', [createSubpath('s', [
  createAnchor('a', { x: 0, y: 0 }),
  createAnchor('b', { x: 100, y: 0 }),
  createAnchor('c', { x: 0, y: 100 })
], true)]);

describe('VectorFillBackend', () => {
  it('compiles lazily and reuses geometry by revision key', async () => {
    const { device, encoder, pass, buffers, destroyed } = fixture();
    const backend = new VectorFillBackend(device as unknown as GPUDevice);
    expect(device.createRenderPipeline).not.toHaveBeenCalled();
    const path = pathFixture();
    const realized = realizeVectorPath(path, 0.25);
    const target = {
      colorView: {} as GPUTextureView,
      stencilView: {} as GPUTextureView,
      format: 'rgba16float' as GPUTextureFormat,
      origin: { x: 0, y: 0 },
      width: 200,
      height: 200
    };

    expect(backend.encodeFill(encoder as unknown as GPUCommandEncoder, path, realized, target)).toBe(true);
    expect(backend.encodeFill(encoder as unknown as GPUCommandEncoder, path, realized, target)).toBe(true);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(3);
    expect(buffers.filter(({ label }) => label.startsWith('LightTable vector geometry'))).toHaveLength(1);
    expect(pass.draw).toHaveBeenCalledTimes(4);
    expect(backend.cacheMetrics()).toMatchObject({ entries: 1, hits: 1, misses: 1 });

    await backend.notifySubmitted();
    expect(destroyed.filter((label) => label === 'LightTable vector draw settings')).toHaveLength(2);
    backend.dispose();
    expect(destroyed.some((label) => label.startsWith('LightTable vector geometry'))).toBe(true);
  });
});
