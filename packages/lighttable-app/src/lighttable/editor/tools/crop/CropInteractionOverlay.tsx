import { useEffect, useRef } from 'react';
import type { Rect } from '../../document/documentTypes';

type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

export interface CropInteractionOverlayProps {
  readonly bounds: Rect;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly imageRect: Rect;
  readonly scale: number;
  readonly onChange: (bounds: Rect) => void;
  readonly onCommit: () => void;
  readonly onCancel: () => void;
}

const normalizedRect = (rect: Rect, width: number, height: number): Rect => {
  const left = Math.max(0, Math.min(width - 1, Math.min(rect.x, rect.x + rect.width)));
  const top = Math.max(0, Math.min(height - 1, Math.min(rect.y, rect.y + rect.height)));
  const right = Math.max(left + 1, Math.min(width, Math.max(rect.x, rect.x + rect.width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.max(rect.y, rect.y + rect.height)));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

export const CropInteractionOverlay = ({
  bounds, documentWidth, documentHeight, imageRect, scale, onChange, onCommit, onCancel
}: CropInteractionOverlayProps) => {
  const drag = useRef<{ handle: CropHandle; x: number; y: number; bounds: Rect } | null>(null);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') { event.preventDefault(); onCommit(); }
      else if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel, onCommit]);
  const begin = (handle: CropHandle, event: React.PointerEvent) => {
    event.preventDefault(); event.stopPropagation();
    drag.current = { handle, x: event.clientX, y: event.clientY, bounds: { ...bounds } };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent) => {
    const active = drag.current; if (!active) return;
    event.preventDefault(); event.stopPropagation();
    const dx = (event.clientX - active.x) / Math.max(scale, 1e-6);
    const dy = (event.clientY - active.y) / Math.max(scale, 1e-6);
    let { x, y, width, height } = active.bounds;
    if (active.handle === 'move') {
      x = Math.max(0, Math.min(documentWidth - width, x + dx));
      y = Math.max(0, Math.min(documentHeight - height, y + dy));
    } else {
      if (active.handle.includes('w')) { x += dx; width -= dx; }
      if (active.handle.includes('e')) width += dx;
      if (active.handle.includes('n')) { y += dy; height -= dy; }
      if (active.handle.includes('s')) height += dy;
    }
    onChange(normalizedRect({ x, y, width, height }, documentWidth, documentHeight));
  };
  const end = (event: React.PointerEvent) => {
    if (!drag.current) return;
    event.preventDefault(); event.stopPropagation(); drag.current = null;
  };
  const style = {
    left: imageRect.x + bounds.x * scale,
    top: imageRect.y + bounds.y * scale,
    width: bounds.width * scale,
    height: bounds.height * scale
  };
  const handles: CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  return <div className="crop-interaction-overlay" aria-label="Crop preview">
    <div className="crop-interaction-overlay__frame" style={style}
      onPointerDown={(event) => begin('move', event)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <i className="crop-interaction-overlay__third crop-interaction-overlay__third--v1" />
      <i className="crop-interaction-overlay__third crop-interaction-overlay__third--v2" />
      <i className="crop-interaction-overlay__third crop-interaction-overlay__third--h1" />
      <i className="crop-interaction-overlay__third crop-interaction-overlay__third--h2" />
      {handles.map((handle) => <button key={handle} type="button" tabIndex={-1} aria-label={`Crop ${handle} handle`}
        className={`crop-interaction-overlay__handle crop-interaction-overlay__handle--${handle}`}
        onPointerDown={(event) => begin(handle, event)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />)}
    </div>
  </div>;
};
