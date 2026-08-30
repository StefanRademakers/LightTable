import { Button, ToolStrip } from '@lighttable/ui';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ToolOptionsContent,
  type ToolOptionsProps
} from './ToolOptionsBar';
import { toolDefinition, type ToolDefinition } from '../tools/toolRegistry';
import { ToolButton, toolFamilyFor } from './EditorToolbar';
import type { ToolId } from '../session/editorSession';


interface ToolOptionsContextMenuProps extends ToolOptionsProps {
  x: number;
  y: number;
  onClose: () => void;
  onToolChange: (tool: ToolId) => void;
  onAlignTransformAxesToDocument?: () => void;
}

const EDGE_GAP = 8;
const CURSOR_OFFSET = 8;

export const placeToolOptionsContextMenu = ({
  x,
  y,
  width,
  height,
  viewportWidth,
  viewportHeight
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}) => {
  const preferredX = x + CURSOR_OFFSET;
  const left = preferredX + width + EDGE_GAP <= viewportWidth
    ? preferredX
    : x - width - CURSOR_OFFSET;
  return {
    x: Math.max(EDGE_GAP, Math.min(left, viewportWidth - width - EDGE_GAP)),
    y: Math.max(EDGE_GAP, Math.min(y, viewportHeight - height - EDGE_GAP))
  };
};

/**
 * A transient, cursor-local vertical projection of the canonical tool controls.
 * It owns no settings: the horizontal bar and this menu dispatch through the
 * exact same commands, so neither surface can drift from the other.
 */
export const ToolOptionsContextMenu: React.FC<ToolOptionsContextMenuProps> = ({
  x,
  y,
  onClose,
  onToolChange,
  onAlignTransformAxesToDocument,
  ...toolOptions
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const update = () => {
      const bounds = menu.getBoundingClientRect();
      setPosition(placeToolOptionsContextMenu({
        x,
        y,
        width: bounds.width,
        height: bounds.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      }));
    };
    update();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(update);
    resizeObserver?.observe(menu);
    window.addEventListener('resize', update);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [toolOptions.activeTool, x, y]);

  const family = toolFamilyFor(toolDefinition(toolOptions.activeTool));
  const relatedTools: readonly ToolDefinition[] = family?.definitions ?? [];

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-editor-floating-control]')) return;
      if (menuRef.current?.contains(target as Node)) return;
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[data-editor-floating-control]')) return;
      onClose();
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
      className="lighttable-tool-options-menu-layout"
      data-editor-floating-surface
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-label="Tool settings"
      onContextMenu={(event) => event.preventDefault()}
    >
      {relatedTools.length > 0 ? (
        <ToolStrip label={family?.label ?? 'Related tools'}>
          {relatedTools.map((tool) => (
            <ToolButton
              key={tool.id}
              tool={tool}
              active={tool.id === toolOptions.activeTool}
              onClick={() => onToolChange(tool.id)}
            />
          ))}
        </ToolStrip>
      ) : null}
      <div className="lighttable-tool-options-menu">
        <ToolOptionsContent {...toolOptions} orientation="vertical" />
        {toolOptions.activeTool === 'transform' && onAlignTransformAxesToDocument ? (
          <div className="lighttable-tool-options__content lighttable-tool-options__content--vertical">
            <Button fullWidth
              title="Align the transform handles to the document without changing the layer"
              onClick={() => {
              onAlignTransformAxesToDocument();
              onClose();
            }}>
              Align Transform Box to Document
            </Button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
};
