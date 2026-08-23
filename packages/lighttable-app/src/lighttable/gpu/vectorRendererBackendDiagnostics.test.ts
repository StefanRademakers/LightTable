import { describe, expect, it, vi } from 'vitest';

describe('vector renderer backend diagnostics', () => {
  it('locks diagnostic profiling with the renderer configuration', async () => {
    vi.resetModules();
    const diagnostics = await import('./vectorRendererBackendDiagnostics');
    diagnostics.configureVectorRendererDetailedProfiling(true);
    expect(diagnostics.vectorRendererDetailedProfilingEnabled()).toBe(true);
    diagnostics.lockVectorRendererConfiguration();
    expect(() => diagnostics.configureVectorRendererDetailedProfiling(false)).toThrow(
      /cannot change after WebGPU initialization/
    );
  });
});
