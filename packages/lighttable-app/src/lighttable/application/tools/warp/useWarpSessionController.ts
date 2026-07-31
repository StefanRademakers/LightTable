import { useMemo, useRef } from 'react';
import type { WarpGestureController } from './warpGestureController';
import {
  createWarpSessionController,
  type WarpSessionController,
  type WarpSessionDependencies
} from './warpSessionController';

/**
 * React lifetime adapter for the application-owned Warp transaction.
 *
 * The session stays stable for one mounted document view while all host,
 * document and history ports resolve from the latest render.
 */
export const useWarpSessionController = (
  dependencies: WarpSessionDependencies,
  gesture?: WarpGestureController
): WarpSessionController => {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  return useMemo(
    () => createWarpSessionController(() => dependenciesRef.current, gesture),
    [gesture]
  );
};
