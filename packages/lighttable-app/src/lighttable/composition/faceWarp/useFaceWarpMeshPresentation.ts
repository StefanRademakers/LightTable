import { useLayoutEffect, useMemo, useRef } from 'react';
import { FaceWarpMeshPresentationBinding, type FaceWarpMeshInputs,
  type FaceWarpMeshRenderer } from '../../application/tools/faceWarp/FaceWarpMeshPresentationBinding';

export const useFaceWarpMeshPresentation = (renderer: FaceWarpMeshRenderer | null,
  session: object | undefined, generation: number, lifecycle: object,
  captureScope: () => { isCurrent(): boolean }, inputs: FaceWarpMeshInputs
) => {
  const latest = useRef({ inputs, session });
  latest.current = { inputs, session };
  const binding = useMemo(() => {
    const scope = captureScope();
    return new FaceWarpMeshPresentationBinding(renderer,
      () => latest.current.session === session && scope.isCurrent(), () => latest.current.inputs);
  }, [renderer, session, generation, lifecycle, captureScope]);
  useLayoutEffect(() => { binding.mount(); return binding.unmount; }, [binding]);
  useLayoutEffect(() => { binding.present(); }, [binding, inputs.active, inputs.visible, inputs.view]);
};
