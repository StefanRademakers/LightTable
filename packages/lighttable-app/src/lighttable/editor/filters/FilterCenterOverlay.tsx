import React, { useEffect, useRef, useState } from "react";
import type { Rect } from "../document/documentTypes";

export interface FilterCenterPoint {
  readonly x: number;
  readonly y: number;
}

interface FilterCenterOverlayProps {
  readonly center: FilterCenterPoint;
  readonly imageRect: Rect;
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly interactive?: boolean;
  readonly onChange: (center: FilterCenterPoint) => void;
  readonly onInteractionStart: () => void;
  readonly onInteractionEnd: () => void;
  readonly onInteractionCancel: () => void;
}

interface DragState {
  readonly pointerId: number;
  readonly capture: SVGCircleElement;
  changed: boolean;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Shared document-space handle for every filter exposing center.x/center.y. */
export const FilterCenterOverlay: React.FC<FilterCenterOverlayProps> = ({
  center,
  imageRect,
  scale,
  width,
  height,
  documentWidth,
  documentHeight,
  interactive = true,
  onChange,
  onInteractionStart,
  onInteractionEnd,
  onInteractionCancel,
}) => {
  const dragRef = useRef<DragState | null>(null);
  const [dragCenter, setDragCenter] = useState<FilterCenterPoint | null>(null);
  const presentedCenter = dragCenter ?? center;
  const screenX =
    imageRect.x + ((documentWidth * clamp(presentedCenter.x, 0, 100)) / 100) * scale;
  const screenY =
    imageRect.y + ((documentHeight * clamp(presentedCenter.y, 0, 100)) / 100) * scale;

  useEffect(() => {
    if (!dragRef.current) setDragCenter(null);
  }, [center.x, center.y]);

  const begin: React.PointerEventHandler<SVGCircleElement> = (event) => {
    if (!interactive || event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      capture: event.currentTarget,
      changed: false,
    };
    setDragCenter(center);
    event.currentTarget.setPointerCapture(event.pointerId);
    onInteractionStart();
    event.preventDefault();
    event.stopPropagation();
  };

  const move: React.PointerEventHandler<SVGSVGElement> = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const documentX =
      (event.clientX - bounds.left - imageRect.x) / Math.max(scale, 1e-6);
    const documentY =
      (event.clientY - bounds.top - imageRect.y) / Math.max(scale, 1e-6);
    const next = {
      x: clamp((documentX / Math.max(documentWidth, 1)) * 100, 0, 100),
      y: clamp((documentY / Math.max(documentHeight, 1)) * 100, 0, 100),
    };
    drag.changed = true;
    setDragCenter(next);
    onChange(next);
    event.preventDefault();
    event.stopPropagation();
  };

  const end: React.PointerEventHandler<SVGSVGElement> = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.capture.hasPointerCapture(event.pointerId)) {
      drag.capture.releasePointerCapture(event.pointerId);
    }
    setDragCenter(null);
    onInteractionEnd();
    event.preventDefault();
    event.stopPropagation();
  };

  const cancel: React.PointerEventHandler<SVGSVGElement> = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.capture.hasPointerCapture(event.pointerId)) {
      drag.capture.releasePointerCapture(event.pointerId);
    }
    setDragCenter(null);
    onInteractionCancel();
    event.preventDefault();
    event.stopPropagation();
  };

  useEffect(() => {
    if (interactive || !dragRef.current) return;
    dragRef.current = null;
    setDragCenter(null);
    onInteractionCancel();
  }, [interactive, onInteractionCancel]);

  return (
    <svg
      className="lighttable-transform"
      style={{ pointerEvents: "none" }}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={cancel}
      aria-label="Filter center controls"
    >
      <line
        className="lighttable-transform__rotation-line"
        x1={screenX - 9}
        y1={screenY}
        x2={screenX + 9}
        y2={screenY}
      />
      <line
        className="lighttable-transform__rotation-line"
        x1={screenX}
        y1={screenY - 9}
        x2={screenX}
        y2={screenY + 9}
      />
      <circle
        className="lighttable-transform__rotation"
        style={{ pointerEvents: "none" }}
        cx={screenX}
        cy={screenY}
        r="5"
      />
      <circle
        style={{
          fill: "transparent",
          stroke: "none",
          cursor: "move",
          pointerEvents: interactive ? "all" : "none",
        }}
        cx={screenX}
        cy={screenY}
        r="14"
        onPointerDown={begin}
      />
    </svg>
  );
};
