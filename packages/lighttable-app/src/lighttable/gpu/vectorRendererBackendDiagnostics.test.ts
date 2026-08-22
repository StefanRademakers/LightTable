import { describe, expect, it, vi } from 'vitest';

describe('vector renderer backend diagnostics', () => {
  it('locks one process-wide backend before WebGPU initialization', async () => {
    vi.resetModules();
    const diagnostics = await import('./vectorRendererBackendDiagnostics');
    diagnostics.configureVectorRendererBackend('vello');

    expect(diagnostics.lockVectorRendererBackendSelection()).toBe('vello');
    expect(() => diagnostics.configureVectorRendererBackend('current')).toThrow(
      /cannot change after WebGPU initialization/
    );
    expect(() => diagnostics.configureVectorRendererBackend('vello')).not.toThrow();
  });
});

