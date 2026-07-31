import { useEffect, useMemo, useRef } from 'react';
import type { WarpGestureController } from './warpGestureController';
import {
  createWarpSessionController,
  type WarpSessionController,
  type WarpSessionDependencies
} from './warpSessionController';
import { createWarpPreviewScheduler } from './warpPreviewScheduler';
import { createWarpHoldScheduler } from './warpHoldScheduler';

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
  const controller = useMemo(
    () => createWarpSessionController(
      () => dependenciesRef.current,
      gesture,
      createWarpPreviewScheduler({
        request: (callback) => requestAnimationFrame(callback),
        cancel: (handle) => cancelAnimationFrame(handle)
      }),
      createWarpHoldScheduler({
        request: (callback) => requestAnimationFrame(callback),
        cancel: (handle) => cancelAnimationFrame(handle)
      })
    ),
    [gesture]
  );
  useEffect(
    () => () => controller.reset(),
    [controller]
  );
  return controller;
};
