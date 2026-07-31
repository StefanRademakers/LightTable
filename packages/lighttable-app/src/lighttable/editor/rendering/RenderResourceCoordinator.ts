import type { LayerId } from '../document/documentTypes';
import type { LayerStyleRenderer } from './LayerStyleRenderer';
import type { SubmittedResourceRetainer } from './SubmittedResourceRetainer';

export interface RenderResourceCoordinatorOptions {
  layerStyles: Pick<
    LayerStyleRenderer,
    'invalidate' | 'releaseCache' | 'releaseTargets'
  >;
  submittedResources: Pick<
    SubmittedResourceRetainer,
    'releaseAfterSubmittedWork' | 'destroyPending'
  >;
}

/**
 * Coordinates renderer-wide cache invalidation and submit-lifetime resources.
 *
 * Feature encoders should not decide how Layer Style caches and transient GPU
 * resources relate to one another. This boundary keeps those policies
 * document-scoped and gives the renderer facade a single lifecycle port.
 */
export class RenderResourceCoordinator {
  constructor(private readonly options: RenderResourceCoordinatorOptions) {}

  invalidateLayer(layerId: LayerId) {
    this.options.layerStyles.invalidate(layerId);
  }

  invalidateAllStyles() {
    this.options.layerStyles.releaseCache();
  }

  releaseStyleTargets() {
    this.options.layerStyles.releaseTargets();
  }

  releaseAfterSubmit() {
    this.options.submittedResources.releaseAfterSubmittedWork();
  }

  destroyPending() {
    this.options.submittedResources.destroyPending();
  }
}
