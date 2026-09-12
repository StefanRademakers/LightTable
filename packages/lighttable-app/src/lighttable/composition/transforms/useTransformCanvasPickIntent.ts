import { useLayoutEffect, useMemo, useRef } from 'react';
import type { DocumentSession } from '../../application/documents/documentSession';
import { TransformCanvasPickIntent, type TransformCanvasPickPorts } from '../../application/tools/transform/TransformCanvasPickIntent';
import type { TransformLayerAlphaPicker } from '../../application/tools/transform/transformLayerPicker';

interface Runtime {
  readonly session: DocumentSession | undefined;
  readonly renderer: TransformLayerAlphaPicker | null;
  readonly lifecycle: object;
  readonly generation: number;
  readonly ready: boolean;
}
type Ports = Omit<TransformCanvasPickPorts, 'getPicker' | 'captureScope'>;

/** Mount admission follows the concrete renderer, not ordinary viewport/inspector rerenders. */
export const useTransformCanvasPickIntent = (
  runtime: Runtime,
  ports: Ports,
  captureRendererScope: () => { isCurrent(): boolean }
) => {
  const latest = useRef({ runtime, ports, captureRendererScope });
  latest.current = { runtime, ports, captureRendererScope };
  const { session, renderer, lifecycle, generation, ready } = runtime;
  const slot = useMemo(() => ({ owner: null as TransformCanvasPickIntent | null }),
    [session, renderer, lifecycle, generation]);
  useLayoutEffect(() => {
    if (!ready || !session || !renderer) return;
    const isMounted = (): boolean => {
      const current = latest.current.runtime;
      return slot.owner === owner && current.ready && current.session === session
        && current.renderer === renderer && current.lifecycle === lifecycle && current.generation === generation
        && session.getSnapshot().lifecycle === 'ready';
    };
    const owner = new TransformCanvasPickIntent(() => ({
      ...latest.current.ports,
      // Reads remain current, while one request retains its initiating mutation ports.
      read: () => latest.current.ports.read(),
      getPicker: () => isMounted() ? renderer : null,
      captureScope: () => {
        const captured = latest.current.captureRendererScope();
        return { isCurrent: () => isMounted() && captured.isCurrent() };
      }
    }));
    slot.owner = owner;
    return () => {
      if (slot.owner === owner) slot.owner = null;
      owner.cancel();
    };
  }, [slot, session, renderer, lifecycle, generation, ready]);
  return useMemo(() => ({
    request: (point: { x: number; y: number }, extend = false) => slot.owner?.request(point, extend) ?? Promise.resolve(false),
    cancel: () => slot.owner?.cancel()
  }), [slot]);
};
