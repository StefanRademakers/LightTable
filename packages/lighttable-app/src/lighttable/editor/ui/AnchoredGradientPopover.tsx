import React from 'react';
import { createPortal } from 'react-dom';

export const AnchoredGradientPopover: React.FC<{
  anchor: React.RefObject<HTMLElement | null>;
  ariaLabel: string;
  children: React.ReactNode;
  onPointerDownCapture?: () => void;
  onPointerUpCapture?: () => void;
}> = ({ anchor, ariaLabel, children, onPointerDownCapture, onPointerUpCapture }) => {
  const [position, setPosition] = React.useState({ left: 12, top: 84 });
  React.useLayoutEffect(() => {
    const update = () => {
      const bounds = anchor.current?.getBoundingClientRect();
      if (!bounds) return;
      setPosition({
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - 348)),
        top: bounds.bottom + 7
      });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [anchor]);
  return createPortal(
    <div className="lighttable-tool-options__gradient-popover" role="dialog"
      aria-label={ariaLabel} style={position}
      onPointerDownCapture={onPointerDownCapture}
      onPointerUpCapture={onPointerUpCapture}>{children}</div>,
    document.body
  );
};
