import React from 'react';
import { AnchoredPopover } from '@mediavibe/ui';

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
  const reference = anchor.current?.closest<HTMLElement>('[data-editor-floating-surface]') ?? null;
  return <AnchoredPopover open anchor={anchor} reference={reference}
    placement={reference ? 'side' : 'auto'} gap={reference ? 6 : 7}
    className={`lighttable-tool-options__gradient-popover${className ? ` ${className}` : ''}`}
    data-editor-floating-control aria-label={ariaLabel} onDismiss={onClose}
    ignoreOutsideTarget={(target) => Boolean(target.closest('[data-ui-component="select-popup"]'))}
    onPointerDownCapture={onPointerDownCapture} onPointerUpCapture={onPointerUpCapture}>
    {children}
  </AnchoredPopover>;
};
