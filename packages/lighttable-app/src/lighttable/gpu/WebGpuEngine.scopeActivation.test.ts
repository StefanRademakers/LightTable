import { describe, expect, it, vi } from 'vitest';
import { WebGpuEngine } from './WebGpuEngine';

describe('WebGpuEngine scope presentation ownership', () => {
  it('re-presents retained scopes when a document becomes active', () => {
    const scopeRuntime = {
      resize: vi.fn(),
      markPresentationDirty: vi.fn()
    };
    const engine = {
      destroyed: false,
      active: false,
      renderScheduler: {
        setPaused: vi.fn(),
        invalidate: vi.fn()
      },
      selectionAntsAnimator: { setActive: vi.fn() },
      documentRenderer: { setActive: vi.fn() },
      scopeRuntime,
      requestRender: vi.fn()
    } as unknown as WebGpuEngine;

    WebGpuEngine.prototype.setActive.call(engine, true);

    expect(scopeRuntime.resize).toHaveBeenCalledOnce();
    expect(scopeRuntime.markPresentationDirty).toHaveBeenCalledOnce();
    expect((engine as unknown as { requestRender: ReturnType<typeof vi.fn> })
      .requestRender).toHaveBeenCalledOnce();
  });

  it('refreshes canvas visibility when scope options expand a hidden section', () => {
    const scopeRuntime = {
      setOptions: vi.fn(() => true),
      resize: vi.fn(() => true)
    };
    const engine = {
      histogramRuntime: { setVisible: vi.fn(() => false) },
      scopeRuntime,
      renderDirty: { invalidate: vi.fn() },
      requestRender: vi.fn()
    } as unknown as WebGpuEngine;

    WebGpuEngine.prototype.setScopeOptions.call(engine, false, {
      hueDistributionVisible: true,
      paradeVisible: true,
      vectorscopeVisible: true,
      quality: 'high',
      traceBrightness: 100,
      vectorscopeRange: 'all',
      vectorscopeZoom2x: false
    });

    expect(scopeRuntime.setOptions).toHaveBeenCalledOnce();
    expect(scopeRuntime.resize).toHaveBeenCalledOnce();
    expect((engine as unknown as { requestRender: ReturnType<typeof vi.fn> })
      .requestRender).toHaveBeenCalledOnce();
  });
});
