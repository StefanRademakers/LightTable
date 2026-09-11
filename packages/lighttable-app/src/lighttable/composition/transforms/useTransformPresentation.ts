import { useLayoutEffect, useMemo, useRef } from 'react';
import { TransformPresentationBinding, type TransformPresentationInputs,
  type TransformPresentationOperations, type TransformPresentationRenderer
} from '../../application/tools/transform/TransformPresentationBinding';

/** React observes the projection; retained callbacks remain bound to their exact mounted lifetime. */
export const useTransformPresentation = (
  renderer: TransformPresentationRenderer | null, session: object | undefined,
  generation: number, lifecycle: object, captureScope: () => { isCurrent(): boolean },
  read: () => TransformPresentationInputs, operations: TransformPresentationOperations
) => {
  const latest = useRef({ read, operations, session });
  latest.current = { read, operations, session };
  const binding = useMemo(() => {
    const scope = captureScope();
    return new TransformPresentationBinding(renderer,
      () => latest.current.session === session && scope.isCurrent(),
      () => latest.current.read(), {
        update: matrix => latest.current.operations.update(matrix),
        updateProjective: quad => latest.current.operations.updateProjective(quad)
      });
  }, [renderer, session, generation, lifecycle, captureScope]);
  const inputs = read();
  useLayoutEffect(() => { binding.mount(); return binding.unmount; }, [binding]);
  useLayoutEffect(() => { binding.present(); }, [binding, inputs.state, inputs.frameOverride,
    inputs.temporaryMove, inputs.scale, inputs.frameMode, inputs.snap.extrasVisible,
    inputs.snap.smartGuidesVisible, inputs.selectionFeedback]);
  return binding;
};
