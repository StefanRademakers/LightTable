import React from 'react';
import { createPortal } from 'react-dom';

const VIEWPORT_MARGIN = 8;
const VIEWPORT_TOP_INSET = 40;
const ANCHOR_GAP = 6;

export interface AnchoredViewportMenuPosition {
  left: number;
  top: number;
  maxHeight: number;
  placement: 'above' | 'below';
}

export const anchoredViewportMenuPosition = (
  anchor: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  menu: { width: number; height: number },
  viewport: { width: number; height: number }
): AnchoredViewportMenuPosition => {
  const above = Math.max(0, anchor.top - ANCHOR_GAP - VIEWPORT_TOP_INSET);
  const below = Math.max(0, viewport.height - anchor.bottom - ANCHOR_GAP - VIEWPORT_MARGIN);
  const placement = above >= below ? 'above' : 'below';
  const available = Math.max(120, placement === 'above' ? above : below);
  const height = Math.min(menu.height, available);
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(anchor.right - menu.width, viewport.width - menu.width - VIEWPORT_MARGIN)
  );
  return {
    left,
    top: placement === 'above'
      ? Math.max(VIEWPORT_TOP_INSET, anchor.top - ANCHOR_GAP - height)
      : Math.max(
          VIEWPORT_TOP_INSET,
          Math.min(anchor.bottom + ANCHOR_GAP, viewport.height - height - VIEWPORT_MARGIN)
        ),
    maxHeight: available,
    placement
  };
};

/** A portal-backed menu that cannot be clipped by dock or floating-panel bounds. */
export const AnchoredViewportMenu: React.FC<{
  anchor: React.RefObject<HTMLElement | null>;
  className: string;
  ariaLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ anchor, className, ariaLabel, onClose, children }) => {
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState<AnchoredViewportMenuPosition | null>(null);

  React.useLayoutEffect(() => {
    const update = () => {
      const anchorElement = anchor.current;
      const menuElement = menuRef.current;
      if (!anchorElement || !menuElement) return;
      const menuBounds = menuElement.getBoundingClientRect();
      const nextPosition = anchoredViewportMenuPosition(
        anchorElement.getBoundingClientRect(),
        {
          width: menuBounds.width,
          // Measure the intrinsic menu content, not its current max-height. Measuring
          // the clamped box creates a two-pass feedback loop in which a tall menu is
          // first placed too low and visibly jumps upward after ResizeObserver fires.
          height: menuElement.scrollHeight
        },
        { width: window.innerWidth, height: window.innerHeight }
      );
      setPosition((current) => (
        current?.left === nextPosition.left
        && current.top === nextPosition.top
        && current.maxHeight === nextPosition.maxHeight
        && current.placement === nextPosition.placement
          ? current
          : nextPosition
      ));
    };
    update();
    const observer = new ResizeObserver(update);
    if (anchor.current) observer.observe(anchor.current);
    if (menuRef.current) observer.observe(menuRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchor]);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    });
    const pointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchor.current?.contains(target) || menuRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', pointerDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', pointerDown, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={className}
      role="menu"
      data-suite-control="anchored-menu"
      aria-label={ariaLabel}
      data-placement={position?.placement}
      data-positioned={position ? 'true' : 'false'}
      data-editor-floating-control
      style={position
        ? { left: position.left, top: position.top, maxHeight: position.maxHeight }
        : {
            left: VIEWPORT_MARGIN,
            top: VIEWPORT_TOP_INSET,
            visibility: 'hidden',
            pointerEvents: 'none'
          }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
          anchor.current?.focus();
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]:not(:disabled)'
        )];
        if (!items.length) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0
          : event.key === 'End' ? items.length - 1
            : (Math.max(0, current) + (event.key === 'ArrowDown' ? 1 : -1) + items.length)
              % items.length;
        items[index]?.focus();
      }}
    >
      {children}
    </div>,
    document.body
  );
};
