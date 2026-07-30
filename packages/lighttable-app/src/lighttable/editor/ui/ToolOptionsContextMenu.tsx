import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ToolOptionsContent,
  type ToolOptionsProps
} from './ToolOptionsBar';

interface ToolOptionsContextMenuProps extends ToolOptionsProps {
  x: number;
  y: number;
  onClose: () => void;
}

const EDGE_GAP = 8;

/**
 * A transient, cursor-local projection of the canonical tool controls.
 * It owns no settings: the horizontal bar and this menu dispatch through the
 * exact same commands, so neither surface can drift from the other.
 */
export const ToolOptionsContextMenu: React.FC<ToolOptionsContextMenuProps> = ({
  x,
  y,
  onClose,
  ...toolOptions
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(EDGE_GAP, Math.min(x, window.innerWidth - bounds.width - EDGE_GAP)),
      y: Math.max(EDGE_GAP, Math.min(y, window.innerHeight - bounds.height - EDGE_GAP))
    });
  }, [x, y]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="lighttable-tool-options-menu"
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-label="Tool settings"
      onContextMenu={(event) => event.preventDefault()}
    >
      <ToolOptionsContent {...toolOptions} orientation="vertical" />
    </div>,
    document.body
  );
};
