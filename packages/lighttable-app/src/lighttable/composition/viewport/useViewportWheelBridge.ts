import { useLayoutEffect, useRef } from 'react';
import { ViewportWheelBridge, type ViewportWheelBridgePorts } from '../../application/viewport/ViewportWheelBridge';

export const useViewportWheelBridge = (read: () => ViewportWheelBridgePorts) => {
  const latest = useRef(read); latest.current = read;
  const owner = useRef<ViewportWheelBridge | null>(null);
  owner.current ??= new ViewportWheelBridge(() => latest.current());
  useLayoutEffect(() => owner.current!.connect(window), []);
};
