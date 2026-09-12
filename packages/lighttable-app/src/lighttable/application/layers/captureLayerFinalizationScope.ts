import type { DocumentSession } from '../documents/documentSession';
import type { LayerFinalizationScope } from './LayerFinalizationReadiness';

interface FinalizationHostScope {
  getCurrentSession(): DocumentSession | undefined;
  getCurrentRenderer(): object | null;
  captureRendererScope(): LayerFinalizationScope;
}

/** Pin the concrete session and renderer independently of public document IDs/revisions. */
export const captureLayerFinalizationScope = (
  session: DocumentSession | undefined, renderer: object | null, host: FinalizationHostScope
): LayerFinalizationScope => {
  const rendererScope = host.captureRendererScope();
  const assertCurrent = () => {
    if (!session || !renderer || host.getCurrentSession() !== session
      || host.getCurrentRenderer() !== renderer || session.getSnapshot().lifecycle !== 'ready') {
      throw new Error('Layer finalization belongs to a retired document renderer.');
    }
    rendererScope.assertCurrent();
  };
  assertCurrent();
  return { assertCurrent };
};
