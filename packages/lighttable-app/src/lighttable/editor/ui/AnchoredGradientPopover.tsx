import React from 'react';
import { createPortal } from 'react-dom';

export const AnchoredGradientPopover: React.FC<{
  anchor: React.RefObject<HTMLElement | null>;
  ariaLabel: string;
  className?: string;
  children: React.ReactNode;
  onClose?: () => void;
  onPointerDownCapture?: () => void;
  onPointerUpCapture?: () => void;
}> = ({
  anchor, ariaLabel, className, children, onClose, onPointerDownCapture, onPointerUpCapture
}) => {
  const [position, setPosition] = React.useState({ left: 12, top: 84 });
  const popoverRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const update = () => {
      const anchorElement = anchor.current;
      const popover = popoverRef.current;
      if (!anchorElement || !popover) return;
      const bounds = anchorElement.getBoundingClientRect();
      const popoverBounds = popover.getBoundingClientRect();
      const surface = anchorElement.closest<HTMLElement>('[data-editor-floating-surface]')
        ?.getBoundingClientRect();
      if (surface) {
        const right = surface.right + 6;
        setPosition({
          left: right + popoverBounds.width <= window.innerWidth - 8
            ? right : Math.max(8, surface.left - popoverBounds.width - 6),
          top: Math.max(8, Math.min(bounds.top, window.innerHeight - popoverBounds.height - 8))
        });
        return;
      }
      const below = bounds.bottom + 7;
      setPosition({
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - popoverBounds.width - 8)),
        top: below + popoverBounds.height <= window.innerHeight - 8
          ? below : Math.max(8, bounds.top - popoverBounds.height - 7)
      });
    };
    update();
    const resizeObserver = new ResizeObserver(update);
    if (popoverRef.current) resizeObserver.observe(popoverRef.current);
    if (anchor.current) resizeObserver.observe(anchor.current);
    window.addEventListener('resize', update);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [anchor, children]);
  React.useEffect(() => {
    if (!onClose) return;
    const pointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchor.current?.contains(target) || popoverRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-ui-component="select-popup"]')) return;
      onClose();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (event.target instanceof Element && event.target.closest('[data-ui-component="select-popup"]')) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('keydown', keyDown, true);
    return () => {
      document.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('keydown', keyDown, true);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div ref={popoverRef}
      className={`lighttable-tool-options__gradient-popover${className ? ` ${className}` : ''}`}
      data-editor-floating-control role="dialog"
      aria-label={ariaLabel} style={position}
      onPointerDownCapture={onPointerDownCapture}
      onPointerUpCapture={onPointerUpCapture}>{children}</div>,
    document.body
  );
};
