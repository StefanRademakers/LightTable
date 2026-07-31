import { describe, expect, it, vi } from 'vitest';
import type { LayerId } from '../document/documentTypes';
import { RenderResourceCoordinator } from './RenderResourceCoordinator';

describe('RenderResourceCoordinator', () => {
  it('routes scoped and complete Layer Style invalidation independently', () => {
    const invalidate = vi.fn();
    const releaseCache = vi.fn();
    const releaseTargets = vi.fn();
    const coordinator = new RenderResourceCoordinator({
      layerStyles: { invalidate, releaseCache, releaseTargets },
      submittedResources: {
        releaseAfterSubmittedWork: vi.fn(),
        destroyPending: vi.fn()
      }
    });
    const layerId = 'layer-1' as LayerId;

    coordinator.invalidateLayer(layerId);
    coordinator.invalidateAllStyles();
    coordinator.releaseStyleTargets();

    expect(invalidate).toHaveBeenCalledWith(layerId);
    expect(releaseCache).toHaveBeenCalledOnce();
    expect(releaseTargets).toHaveBeenCalledOnce();
  });

  it('separates normal submit completion from terminal destruction', () => {
    const releaseAfterSubmittedWork = vi.fn();
    const destroyPending = vi.fn();
    const coordinator = new RenderResourceCoordinator({
      layerStyles: {
        invalidate: vi.fn(),
        releaseCache: vi.fn(),
        releaseTargets: vi.fn()
      },
      submittedResources: {
        releaseAfterSubmittedWork,
        destroyPending
      }
    });

    coordinator.releaseAfterSubmit();
    expect(releaseAfterSubmittedWork).toHaveBeenCalledOnce();
    expect(destroyPending).not.toHaveBeenCalled();

    coordinator.destroyPending();
    expect(destroyPending).toHaveBeenCalledOnce();
  });
});
