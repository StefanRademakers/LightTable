import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { DocumentViewport } from '../../application/documents/documentSession';
import { resolveViewportImageRect } from '../../application/rendering/viewportRenderState';
import { zoomViewToScaleAtPoint } from '../../editor/tools/pointer/viewportCoordinates';
import { zoomPercentToScale } from '../../editor/tools/zoom/zoomLevels';

interface ViewportSize { readonly width: number; readonly height: number }
interface ViewportView { readonly scale: number; readonly panX: number; readonly panY: number }

export interface ViewportZoomCommandPorts {
  readonly metadata: { readonly width: number; readonly height: number } | null;
  readonly viewportSize: ViewportSize;
  readonly activeScale: number;
  readonly view: ViewportView;
  readonly resizeViewport: (width: number, height: number, pixelRatio: number,
    imageRect: ReturnType<typeof resolveViewportImageRect>) => void;
  readonly setViewport: Dispatch<SetStateAction<DocumentViewport>>;
  readonly execute: (parameters: { readonly mode: 'fit' | '100' | 'custom'; readonly percent?: number }) => void;
}

/** Owns immediate renderer projection plus canonical document viewport updates. */
export const useViewportZoomCommands = (ports: ViewportZoomCommandPorts) => {
  const presentImmediately = useCallback((scale: number, panX: number, panY: number) => {
    if (!ports.metadata) return;
    ports.resizeViewport(
      ports.viewportSize.width,
      ports.viewportSize.height,
      Math.max(1, window.devicePixelRatio || 1),
      resolveViewportImageRect(
        ports.metadata.width,
        ports.metadata.height,
        ports.viewportSize.width,
        ports.viewportSize.height,
        scale,
        panX,
        panY
      )
    );
  }, [ports.metadata, ports.resizeViewport, ports.viewportSize.height, ports.viewportSize.width]);

  const applyExact = useCallback((percent: number) => {
    const nextView = zoomViewToScaleAtPoint({
      cursor: { x: ports.viewportSize.width / 2, y: ports.viewportSize.height / 2 },
      viewport: ports.viewportSize,
      view: { scale: ports.activeScale, panX: ports.view.panX, panY: ports.view.panY },
      scale: zoomPercentToScale(percent)
    });
    presentImmediately(nextView.scale, nextView.panX, nextView.panY);
    ports.setViewport(current => ({ ...current, zoomMode: 'custom', ...nextView }));
  }, [ports.activeScale, ports.setViewport, ports.view.panX, ports.view.panY,
    ports.viewportSize, presentImmediately]);

  const applyFit = useCallback(() => {
    const fitScale = ports.metadata
      ? Math.min(ports.viewportSize.width / ports.metadata.width,
          ports.viewportSize.height / ports.metadata.height) * 0.94
      : 1;
    presentImmediately(fitScale, 0, 0);
    ports.setViewport(current => ({ ...current, zoomMode: 'fit', scale: 1, panX: 0, panY: 0 }));
  }, [ports.metadata, ports.setViewport, ports.viewportSize.height, ports.viewportSize.width, presentImmediately]);

  const applyActual = useCallback(() => {
    presentImmediately(1, 0, 0);
    ports.setViewport(current => ({ ...current, zoomMode: '100', scale: 1, panX: 0, panY: 0 }));
  }, [ports.setViewport, presentImmediately]);

  const requestExact = useCallback((percent: number) => {
    ports.execute({ mode: 'custom', percent });
  }, [ports.execute]);
  const requestFit = useCallback(() => { ports.execute({ mode: 'fit' }); }, [ports.execute]);
  const requestActual = useCallback(() => { ports.execute({ mode: '100' }); }, [ports.execute]);

  return { applyExact, applyFit, applyActual, requestExact, requestFit, requestActual } as const;
};
