import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { CanvasPickerController, type CanvasPickerPorts } from '../../application/adjustments/CanvasPickerController';

/** React observes picker presentation; requests retain their opening ports and scope. */
export const useCanvasPickers = (documentIdentity: object | string, ports: CanvasPickerPorts) => {
  const portsRef = useRef(ports);
  portsRef.current = ports;
  const controller = useMemo(() => new CanvasPickerController(() => portsRef.current), []);
  useLayoutEffect(() => () => controller.reset(), [controller, documentIdentity]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return { controller, ...snapshot };
};
