import { beforeEach, describe, expect, it, vi } from 'vitest';
import { identityMatrix } from '@lighttable/vector-core';
import type { VectorEditingOverlay } from '@lighttable/vector-rendering';
import { VectorEditingOverlayBackend } from './VectorEditingOverlayBackend';

beforeEach(() => {
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 });
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
});

const fixture = () => {
  const destroyed: string[] = [];
  const buffers: { label: string; destroy: ReturnType<typeof vi.fn> }[] = [];
  const pass = {
    setBindGroup: vi.fn(),
    setPipeline: vi.fn(),
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

const overlayFixture = (): VectorEditingOverlay => ({
  pathId: 'path',
  resourceKey: 'path:4:2:8:subpath/a:subpath/a',
  geometryRevision: 4,
  transformRevision: 2,
  cubics: [{
    subpathId: 'subpath',
    segmentIndex: 0,
    p0: { x: 10, y: 10 },
    p1: { x: 30, y: 0 },
    p2: { x: 70, y: 100 },
    p3: { x: 90, y: 90 }
  }],
  anchors: [
    {
      subpathId: 'subpath',
      anchorId: 'a',
      point: { x: 10, y: 10 },
      markerSizePx: 7,
      selected: true,
      active: true
    },
    {
      subpathId: 'subpath',
      anchorId: 'b',
      point: { x: 90, y: 90 },
      markerSizePx: 7,
      selected: false,
      active: false
    }
  ],
  handles: [{
    subpathId: 'subpath',
    anchorId: 'a',
    kind: 'out',
    anchor: { x: 10, y: 10 },
    point: { x: 30, y: 0 },
    markerSizePx: 6
  }]
});

describe('VectorEditingOverlayBackend', () => {
  it('keeps overlay geometry cached while viewport uniforms change', async () => {
    const { device, encoder, pass, buffers, destroyed } = fixture();
    const backend = new VectorEditingOverlayBackend(device as unknown as GPUDevice);
    const overlay = overlayFixture();
    const target = {
      colorView: {} as GPUTextureView,
      format: 'rgba16float' as GPUTextureFormat,
      width: 800,
      height: 600,
      documentToViewport: identityMatrix()
    };

    expect(device.createRenderPipeline).not.toHaveBeenCalled();
    expect(backend.encode(encoder as unknown as GPUCommandEncoder, overlay, target)).toBe(true);
    expect(backend.encode(encoder as unknown as GPUCommandEncoder, overlay, {
      ...target,
      documentToViewport: { ...identityMatrix(), tx: 120, ty: -40 }
    })).toBe(true);

    expect(device.createRenderPipeline).toHaveBeenCalledTimes(2);
    expect(buffers.filter(({ label }) => label.includes('vector overlay curves'))).toHaveLength(1);
    expect(buffers.filter(({ label }) => label.includes('vector overlay handles'))).toHaveLength(1);
    expect(buffers.filter(({ label }) => label.includes('vector overlay markers'))).toHaveLength(1);
    expect(buffers.filter(({ label }) => label === 'LightTable vector overlay settings')).toHaveLength(6);
    expect(pass.draw).toHaveBeenCalledTimes(6);
    expect(pass.draw).toHaveBeenNthCalledWith(1, 6, 24);
    expect(pass.draw).toHaveBeenNthCalledWith(2, 6, 1);
    expect(pass.draw).toHaveBeenNthCalledWith(3, 6, 3);
    expect(backend.cacheMetrics()).toMatchObject({ entries: 1, hits: 1, misses: 1 });

    await backend.notifySubmitted();
    expect(destroyed.filter((label) => label === 'LightTable vector overlay settings')).toHaveLength(6);
    backend.dispose();
    expect(destroyed.filter((label) => label.includes('vector overlay curves'))).toHaveLength(1);
    expect(destroyed.filter((label) => label.includes('vector overlay handles'))).toHaveLength(1);
    expect(destroyed.filter((label) => label.includes('vector overlay markers'))).toHaveLength(1);
  });

  it('invalidates only resources owned by the requested path', () => {
    const { device, encoder } = fixture();
    const backend = new VectorEditingOverlayBackend(device as unknown as GPUDevice);
    const target = {
      colorView: {} as GPUTextureView,
      format: 'rgba16float' as GPUTextureFormat,
      width: 100,
      height: 100,
      documentToViewport: identityMatrix()
    };
    backend.encode(encoder as unknown as GPUCommandEncoder, overlayFixture(), target);
    backend.encode(encoder as unknown as GPUCommandEncoder, {
      ...overlayFixture(),
      pathId: 'other',
      resourceKey: 'other:1:0:0:-:-'
    }, target);

    expect(backend.invalidatePath('path')).toBe(1);
    expect(backend.cacheMetrics().entries).toBe(1);
    backend.dispose();
  });
});
