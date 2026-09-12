import { useLayoutEffect, useMemo, useRef } from 'react';
import type { DocumentSession } from '../../application/documents/documentSession';
import { createMountedAutomationGestureBinding, type MountedAutomationGesturePorts } from '../../application/commands/MountedAutomationGestureBinding';

interface Runtime {
  readonly session: DocumentSession | undefined;
  readonly renderer: object | null;
  readonly lifecycle: object;
  readonly generation: number;
  readonly ready: boolean;
}
type Binding = ReturnType<typeof createMountedAutomationGestureBinding>;
type Commands = Pick<Binding, 'beginGesture' | 'updateGesture' | 'finishGesture'>;

/** React connects the gesture owner only at runtime lifetime boundaries, not command-port rerenders. */
export const useMountedAutomationGestures = (
  runtime: Runtime,
  ports: MountedAutomationGesturePorts,
  captureRendererScope: () => { isCurrent(): boolean }
): Commands => {
  const latest = useRef({ runtime, ports, captureRendererScope });
  latest.current = { runtime, ports, captureRendererScope };
  const { session, renderer, lifecycle, generation, ready } = runtime;
  const slot = useMemo(() => ({ binding: null as Binding | null }),
    [session, renderer, lifecycle, generation]);
  useLayoutEffect(() => {
    if (!ready || !session || !renderer) return;
    const binding = createMountedAutomationGestureBinding(session, renderer, {
      getCurrentSession: () => latest.current.runtime.session,
      getCurrentRenderer: () => latest.current.runtime.renderer,
      captureRendererScope: () => {
        const captured = latest.current.captureRendererScope();
        return { isCurrent: () => {
          const current = latest.current.runtime;
          return current.ready && current.lifecycle === lifecycle && current.generation === generation
            && captured.isCurrent();
        } };
      }
    }, () => latest.current.ports);
    slot.binding = binding;
    return () => {
      if (slot.binding === binding) slot.binding = null;
      binding.retire();
    };
  }, [slot, ready, session, renderer, lifecycle, generation]);
  return useMemo(() => ({
    beginGesture: (...args: Parameters<Binding['beginGesture']>) => slot.binding?.beginGesture(...args) ?? false,
    updateGesture: (...args: Parameters<Binding['updateGesture']>) => slot.binding?.updateGesture(...args) ?? false,
    finishGesture: (...args: Parameters<Binding['finishGesture']>) => slot.binding?.finishGesture(...args) ?? false
  }), [slot]);
};
