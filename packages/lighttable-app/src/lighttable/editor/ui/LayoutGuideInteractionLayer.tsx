import React, { useRef } from 'react';
import type { DocumentGuide, Rect } from '../document/documentTypes';
import { quantizeGuideToRulerTick, rulerTicks } from '../../application/tools/snapping/rulerTicks';

interface Props {
  imageRect: Rect;
  scale: number;
  guides: readonly DocumentGuide[];
  rulersVisible: boolean;
  guidesVisible: boolean;
  guidesLocked: boolean;
  interactive: boolean;
  onDraft: (guides: readonly DocumentGuide[] | null) => void;
  onCommit: (guides: readonly DocumentGuide[]) => void;
}

interface Drag {
  pointerId: number;
  guide: DocumentGuide;
  baseOrientation: DocumentGuide['orientation'];
  original: readonly DocumentGuide[];
}

export const LayoutGuideInteractionLayer = ({
  imageRect, scale, guides, rulersVisible, guidesVisible,
  guidesLocked, interactive, onDraft, onCommit
}: Props) => {
  const root = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const xTicks = rulersVisible ? rulerTicks(imageRect.width / scale, scale) : [];
  const yTicks = rulersVisible ? rulerTicks(imageRect.height / scale, scale) : [];
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = root.current?.getBoundingClientRect();
    if (!bounds) return { screenX: 0, screenY: 0, x: 0, y: 0 };
    return {
      screenX: event.clientX - bounds.left,
      screenY: event.clientY - bounds.top,
      x: (event.clientX - bounds.left - imageRect.x) / Math.max(1e-6, scale),
      y: (event.clientY - bounds.top - imageRect.y) / Math.max(1e-6, scale)
    };
  };
  const begin = (event: React.PointerEvent<HTMLDivElement>, guide: DocumentGuide) => {
    if (event.button !== 0 || guidesLocked) return;
    drag.current = {
      pointerId: event.pointerId,
      guide,
      baseOrientation: guide.orientation,
      original: guides.map((item) => ({ ...item }))
    };
    root.current?.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const cursor = point(event);
    const orientation = event.altKey
      ? active.baseOrientation === 'horizontal' ? 'vertical' : 'horizontal'
      : active.baseOrientation;
    const raw = orientation === 'vertical' ? cursor.x : cursor.y;
    const length = orientation === 'vertical' ? imageRect.width / scale : imageRect.height / scale;
    const position = event.shiftKey ? quantizeGuideToRulerTick(raw, length, scale) : raw;
    active.guide = { ...active.guide, orientation, position };
    const next = active.original.filter(({ id }) => id !== active.guide.id).concat(active.guide);
    onDraft(next);
    event.preventDefault();
    event.stopPropagation();
  };
  const cancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    onDraft(null);
    if (root.current?.hasPointerCapture(event.pointerId)) {
      root.current.releasePointerCapture(event.pointerId);
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const cursor = point(event);
    const inside = cursor.x >= 0 && cursor.y >= 0
      && cursor.x <= imageRect.width / scale && cursor.y <= imageRect.height / scale;
    const next = inside
      ? active.original.filter(({ id }) => id !== active.guide.id).concat(active.guide)
      : active.original.filter(({ id }) => id !== active.guide.id);
    drag.current = null;
    onDraft(null);
    onCommit(next);
    if (root.current?.hasPointerCapture(event.pointerId)) {
      root.current.releasePointerCapture(event.pointerId);
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const createFromRuler = (orientation: DocumentGuide['orientation']) => (event: React.PointerEvent<HTMLDivElement>) => {
    const cursor = point(event);
    begin(event, {
      id: `guide-${crypto.randomUUID()}`,
      orientation,
      position: orientation === 'vertical' ? cursor.x : cursor.y
    });
  };

  return <div ref={root} className="lighttable-layout-guides"
    onPointerMove={move} onPointerUp={end} onPointerCancel={cancel}>
    {rulersVisible ? <>
      <div className="lighttable-ruler lighttable-ruler--horizontal" onPointerDown={createFromRuler('horizontal')}>
        {xTicks.map((tick) => <i key={tick.position} className={tick.major ? 'major' : ''}
          style={{ left: imageRect.x + tick.position * scale }}><span>{tick.label}</span></i>)}
      </div>
      <div className="lighttable-ruler lighttable-ruler--vertical" onPointerDown={createFromRuler('vertical')}>
        {yTicks.map((tick) => <i key={tick.position} className={tick.major ? 'major' : ''}
          style={{ top: imageRect.y + tick.position * scale }}><span>{tick.label}</span></i>)}
      </div>
      <div className="lighttable-ruler-corner" />
    </> : null}
    {interactive && guidesVisible && !guidesLocked ? guides.map((guide) => <div
      key={guide.id}
      className={`lighttable-guide-hit lighttable-guide-hit--${guide.orientation}`}
      style={guide.orientation === 'vertical'
        ? { left: imageRect.x + guide.position * scale, top: imageRect.y, height: imageRect.height }
        : { top: imageRect.y + guide.position * scale, left: imageRect.x, width: imageRect.width }}
      onPointerDown={(event) => begin(event, { ...guide })}
    />) : null}
  </div>;
};
