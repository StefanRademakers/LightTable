import { beforeEach, describe, expect, it, vi } from 'vitest';
import { identityMatrix } from '@lighttable/vector-core';
import type { VectorEditingOverlay, VectorSelectionFrame } from '@lighttable/vector-rendering';
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

  it('updates the dash phase through uniforms without rebuilding geometry', () => {
    const { device, encoder, buffers } = fixture();
    const backend = new VectorEditingOverlayBackend(device as unknown as GPUDevice);
    const target = {
      colorView: {} as GPUTextureView,
      format: 'rgba16float' as GPUTextureFormat,
      width: 100,
      height: 100,
      documentToViewport: identityMatrix()
    };
    const theme = {
      pathColor: [1, 1, 1, 1] as const,
      handleColor: [1, 1, 1, 1] as const,
      pathWidthPx: 1,
      handleWidthPx: 1,
      dashLengthPx: 5,
      gapLengthPx: 4,
      dashOffsetPx: 8
    };

    backend.encode(encoder as unknown as GPUCommandEncoder, overlayFixture(), target, theme);

    const settingsWrites = device.queue.writeBuffer.mock.calls.filter(
      ([buffer]) => buffer.label === 'LightTable vector overlay settings'
    );
    expect(settingsWrites.some(([, , data]) => (
      data instanceof Float32Array && data.length === 20 && data[16] === 8
    ))).toBe(true);
    expect(buffers.filter(({ label }) => label.includes('vector overlay curves'))).toHaveLength(1);
    backend.dispose();
  });

  it('caches a shared selection frame independently from viewport changes', () => {
    const { device, encoder, pass, buffers } = fixture();
    const backend = new VectorEditingOverlayBackend(device as unknown as GPUDevice);
    const target = {
      colorView: {} as GPUTextureView,
      format: 'rgba16float' as GPUTextureFormat,
      width: 400,
      height: 300,
      documentToViewport: identityMatrix()
    };
    const frame: VectorSelectionFrame = {
      resourceKey: 'selection-frame:4:a,b',
      bounds: { x: 10, y: 20, width: 80, height: 60 },
      pivot: { x: 50, y: 50 },
      edges: [
        { start: { x: 10, y: 20 }, end: { x: 90, y: 20 } },
        { start: { x: 90, y: 20 }, end: { x: 90, y: 80 } },
        { start: { x: 90, y: 80 }, end: { x: 10, y: 80 } },
        { start: { x: 10, y: 80 }, end: { x: 10, y: 20 } }
      ],
      handles: [{ kind: 'north-west', point: { x: 10, y: 20 }, markerSizePx: 8 }]
    };

    expect(backend.encodeSelectionFrame(encoder as unknown as GPUCommandEncoder, frame, target))
      .toBe(true);
    expect(backend.encodeSelectionFrame(encoder as unknown as GPUCommandEncoder, frame, {
      ...target,
      documentToViewport: { ...identityMatrix(), tx: 20 }
    })).toBe(true);

    expect(buffers.filter(({ label }) => label.includes('vector overlay curves'))).toHaveLength(1);
    expect(buffers.filter(({ label }) => label.includes('vector overlay markers'))).toHaveLength(1);
    expect(pass.draw).toHaveBeenNthCalledWith(1, 6, 96);
    expect(pass.draw).toHaveBeenNthCalledWith(2, 6, 2);
    expect(backend.cacheMetrics()).toMatchObject({ entries: 1, hits: 1, misses: 1 });
    backend.dispose();
  });
});
