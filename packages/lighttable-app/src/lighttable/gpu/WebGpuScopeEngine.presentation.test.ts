import { expect, it, vi } from 'vitest';
import { WebGpuScopeEngine, type ScopeErrorLease } from './WebGpuScopeEngine';

const fixture = () => {
  let complete!: (error: GPUError | null) => void;
  const pop = new Promise<GPUError | null>(resolve => { complete = resolve; });
  const lease: ScopeErrorLease = { isCurrent: vi.fn(() => true), report: vi.fn() };
  const surfaces = { isCurrent: () => true, canvases: {} };
  const engine = Object.assign(Object.create(WebGpuScopeEngine.prototype), {
    device: { pushErrorScope: vi.fn(), popErrorScope: () => pop }, surfaces,
    captureErrorLease: () => lease, destroyed: false, failed: false, metadata: {},
    canvasVisibility: { hueDistribution: true },
    encodeInternal: vi.fn(() => ({ analysisPasses: 0, displayPasses: 1 }))
  }) as WebGpuScopeEngine;
  return { engine, surfaces, lease, complete };
};

it.each(['attachment', 'document', 'destroy'] as const)('late validation cannot disable a successor after %s retirement', async kind => {
  const { engine, surfaces, lease, complete } = fixture();
  engine.encode({} as GPUCommandEncoder);
  if (kind === 'attachment') surfaces.canvases = {};
  else if (kind === 'document') vi.mocked(lease.isCurrent).mockReturnValue(false);
  else Object.assign(engine, { destroyed: true });
  complete({ message: 'retired validation' } as GPUError); await Promise.resolve();
  expect(lease.report).not.toHaveBeenCalled();
  expect((engine as unknown as { failed: boolean }).failed).toBe(false);
});

it('current validation failure remains visible and disables only its owned scope engine', async () => {
  const { engine, lease, complete } = fixture(); engine.encode({} as GPUCommandEncoder);
  complete({ message: 'current validation' } as GPUError); await Promise.resolve();
  expect(lease.report).toHaveBeenCalledWith('LightTable scopes disabled: current validation');
  expect((engine as unknown as { failed: boolean }).failed).toBe(true);
});
