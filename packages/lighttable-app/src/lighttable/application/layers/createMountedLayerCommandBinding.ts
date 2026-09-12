import type { DocumentSession } from '../documents/documentSession';
import { MountedLayerCommandAdapter, type MountedLayerCommandPorts } from './MountedLayerCommandAdapter';

interface MountedLayerCommandScope {
  getCurrentSession(): DocumentSession | undefined;
  getCurrentRenderer(): object | null;
  captureRendererScope(): { assertCurrent(): void };
}

/** Register one session/renderer; capture its interaction generation at each request. */
export const createMountedLayerCommandBinding = (
  session: DocumentSession | undefined,
  renderer: object | null,
  scope: MountedLayerCommandScope,
  ports: Omit<MountedLayerCommandPorts, 'assertCurrent'>
) => new MountedLayerCommandAdapter(() => {
  const rendererScope = scope.captureRendererScope();
  return {
    ...ports,
    assertCurrent: () => {
      if (!session || !renderer || scope.getCurrentSession() !== session
        || scope.getCurrentRenderer() !== renderer || session.getSnapshot().lifecycle !== 'ready') {
        throw new Error('Layer command belongs to a retired document renderer.');
      }
      rendererScope.assertCurrent();
    }
  };
}).execute;
