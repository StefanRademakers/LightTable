import React, { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { DocumentGuide, Rect } from '../document/documentTypes';
import { rulerTicks } from '../../application/tools/snapping/rulerTicks';
import type { DocumentGuideInteraction, DocumentGuideLease } from '../../application/tools/snapping/DocumentGuideInteraction';

interface Props {
  imageRect: Rect;
  scale: number;
  guides: readonly DocumentGuide[];
  rulersVisible: boolean;
  guidesVisible: boolean;
  guidesLocked: boolean;
  interactive: boolean;
  ready: boolean;
  interaction: DocumentGuideInteraction;
}

interface Drag {
  pointerId: number;
  lease: DocumentGuideLease;
}

export const LayoutGuideInteractionLayer = ({
  imageRect, scale, guides: canonicalGuides, rulersVisible, guidesVisible,
  guidesLocked, interactive, ready, interaction
}: Props) => {
  const root = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const draft = useSyncExternalStore(interaction.subscribe, interaction.getSnapshot, interaction.getSnapshot);
  const guides = draft ?? canonicalGuides;
  const release = () => {
    const active = drag.current; drag.current = null;
    if (active && root.current?.hasPointerCapture(active.pointerId)) root.current.releasePointerCapture(active.pointerId);
  };
  useLayoutEffect(() => {
    const unsubscribe = interaction.subscribe(() => { if (drag.current && !drag.current.lease.isCurrent()) release(); });
    return () => { drag.current?.lease.cancel(); release(); unsubscribe(); };
  }, [interaction]);
  useLayoutEffect(() => {
    if (!ready || guidesLocked) { drag.current?.lease.cancel(); release(); }
  }, [ready, guidesLocked]);
  const xTicks = useMemo(() => rulersVisible ? rulerTicks(imageRect.width / scale, scale) : [], [rulersVisible, imageRect.width, scale]);
  const yTicks = useMemo(() => rulersVisible ? rulerTicks(imageRect.height / scale, scale) : [], [rulersVisible, imageRect.height, scale]);
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
  const begin = (event: React.PointerEvent<HTMLDivElement>, lease: DocumentGuideLease | null) => {
    if (!lease) return;
    drag.current = { pointerId: event.pointerId, lease };
    root.current?.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const cursor = point(event);
    active.lease.move({ ...cursor, scale, altKey: event.altKey, shiftKey: event.shiftKey });
    event.preventDefault();
    event.stopPropagation();
  };
  const cancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    active.lease.cancel(); release();
    event.preventDefault();
    event.stopPropagation();
  };
  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const cursor = point(event);
    const inside = cursor.x >= 0 && cursor.y >= 0
      && cursor.x <= imageRect.width / scale && cursor.y <= imageRect.height / scale;
    active.lease.finish({ ...cursor, scale, altKey: event.altKey, shiftKey: event.shiftKey }, inside);
    release();
    event.preventDefault();
    event.stopPropagation();
  };
  const createFromRuler = (orientation: DocumentGuide['orientation']) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 0 && !guidesLocked && ready) begin(event, interaction.beginNew(orientation));
  };

  return <div ref={root} className="lighttable-layout-guides"
    onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={cancel}>
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
      onPointerDown={(event) => {
        if (event.button === 0 && !guidesLocked && ready) begin(event, interaction.beginExisting(guide.id));
      }}
    />) : null}
  </div>;
};
