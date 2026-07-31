import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentHistogramRuntime } from './documentHistogramRuntime';

const bufferUsage = {
  UNIFORM: 1,
  COPY_DST: 2,
  STORAGE: 4,
  COPY_SRC: 8,
  MAP_READ: 16
};

describe('DocumentHistogramRuntime', () => {
  beforeEach(() => {
    vi.stubGlobal('GPUBufferUsage', bufferUsage);
  });

  it('owns document histogram resources and encodes at most one pending sample', () => {
    const buffers: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
    const device = {
      createBuffer: vi.fn(() => {
        const buffer = { destroy: vi.fn() };
        buffers.push(buffer);
        return buffer;
      }),
      createBindGroup: vi.fn(() => ({})),
      queue: { writeBuffer: vi.fn() }
    } as unknown as GPUDevice;
    const pipeline = {
      getBindGroupLayout: vi.fn(() => ({}))
    } as unknown as GPUComputePipeline;
    const runtime = new DocumentHistogramRuntime(device, pipeline, undefined, vi.fn());
    const source = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
    const corrected = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
    runtime.configure(source, corrected, {
      width: 1600,
      height: 900
    } as never);
    const readBuffer = { destroy: vi.fn() } as unknown as GPUBuffer;
    (device.createBuffer as ReturnType<typeof vi.fn>).mockReturnValueOnce(readBuffer);
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      dispatchWorkgroups: vi.fn(),
      end: vi.fn()
    };
    const encoder = {
      clearBuffer: vi.fn(),
      beginComputePass: vi.fn(() => pass),
      copyBufferToBuffer: vi.fn()
    } as unknown as GPUCommandEncoder;

    expect(runtime.encode(encoder, { before: false, required: true })).toBe(readBuffer);
    expect(runtime.encode(encoder, { before: false, required: true })).toBeNull();
    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(100, 57);

    runtime.destroy();
    expect(buffers[0]?.destroy).toHaveBeenCalledOnce();
    expect(buffers[1]?.destroy).toHaveBeenCalledOnce();
  });

  it('does not encode while hidden or clean', () => {
    const device = {
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createBindGroup: vi.fn(() => ({})),
      queue: { writeBuffer: vi.fn() }
    } as unknown as GPUDevice;
    const pipeline = {
      getBindGroupLayout: vi.fn(() => ({}))
    } as unknown as GPUComputePipeline;
    const runtime = new DocumentHistogramRuntime(device, pipeline, undefined, vi.fn());
    const texture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
    runtime.configure(texture, texture, { width: 100, height: 100 } as never);
    const encoder = {} as GPUCommandEncoder;

    expect(runtime.encode(encoder, { before: false, required: false })).toBeNull();
    expect(runtime.setVisible(false)).toBe(false);
    expect(runtime.encode(encoder, { before: false, required: true })).toBeNull();
    expect(runtime.setVisible(true)).toBe(true);

    runtime.destroy();
  });
});
