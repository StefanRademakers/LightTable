import React from 'react';
import { createPortal } from 'react-dom';
import { PaintField } from '@lighttable/ui';
import { ColorPicker, colorPickerHex, colorPickerParseHex } from './ColorPicker';
import { sampleScreenColor } from './colorSampling';

export { sampleScreenColor } from './colorSampling';

const POPOVER_GAP = 6;
type PopoverAnchorRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;

export const colorPickerPopoverAnchor = (
  trigger: PopoverAnchorRect,
  containingSurface?: Pick<DOMRect, 'left' | 'right'> | null
): PopoverAnchorRect => containingSurface ? {
  left: containingSurface.left,
  right: containingSurface.right,
  top: trigger.top,
  bottom: trigger.bottom
} : trigger;

export const colorPickerPopoverPosition = (
  trigger: PopoverAnchorRect,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
) => {
  const right = trigger.right + POPOVER_GAP;
  const left = right + size.width <= viewport.width - POPOVER_GAP
    ? right
    : Math.max(POPOVER_GAP, trigger.left - size.width - POPOVER_GAP);
  return {
    left: Math.min(left, Math.max(POPOVER_GAP, viewport.width - size.width - POPOVER_GAP)),
    top: Math.min(Math.max(POPOVER_GAP, trigger.top), Math.max(POPOVER_GAP, viewport.height - size.height - POPOVER_GAP))
  };
};

export interface ColorSwatchFieldProps {
  readonly value: string;
  readonly ariaLabel: string;
  readonly size?: 'compact' | 'chip';
  readonly accessory?: 'sampler' | 'chevron';
  /** Lets a composite paint control own the popover while reusing this trigger. */
  readonly expanded?: boolean;
  readonly onActivate?: () => void;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly tabIndex?: number;
  readonly onChange: (value: string) => void;
  readonly onInteractionStart?: () => void;
  readonly onInteractionCommit?: () => void;
  readonly onInteractionCancel?: () => void;
}

/** Canonical solid-color editor: one value shared by manual and sampled input. */
export const ColorSwatchField: React.FC<ColorSwatchFieldProps> = ({
  value,
  ariaLabel,
  size = 'compact',
  accessory = 'sampler',
  expanded,
  onActivate,
  className,
  disabled = false,
  tabIndex = -1,
  onChange,
  onInteractionStart,
  onInteractionCommit,
  onInteractionCancel
}) => {
  const [sampling, setSampling] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const presentedOpen = expanded ?? open;
  const [position, setPosition] = React.useState({ left: 0, top: 0 });
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const openingValueRef = React.useRef(value);

  const close = React.useCallback((commit: boolean) => {
    setOpen(false);
    if (commit) onInteractionCommit?.();
    else {
      onChange(openingValueRef.current);
      onInteractionCancel?.();
    }
  }, [onChange, onInteractionCancel, onInteractionCommit]);

  React.useLayoutEffect(() => {
    if (!open || !triggerRef.current || !popoverRef.current) return;
    const update = () => {
      const trigger = triggerRef.current!;
      const containingSurface = trigger.closest<HTMLElement>('[data-editor-floating-surface]');
      setPosition(colorPickerPopoverPosition(
        colorPickerPopoverAnchor(
          trigger.getBoundingClientRect(),
          containingSurface?.getBoundingClientRect()
        ),
        popoverRef.current!.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight }
      ));
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(popoverRef.current);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      // A picker's context menu is portalled outside the popover. Let its action
      // finish instead of unmounting it during the capture phase.
      if (target instanceof Element && target.closest('[data-ui-menu-owner], [data-ui-component="select-popup"]')) return;
      close(true);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (event.target instanceof Element && event.target.closest('[data-ui-menu-owner], [data-ui-component="select-popup"]')) return;
      event.preventDefault();
      close(false);
    };
    document.addEventListener('pointerdown', pointer, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', pointer, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [close, open]);

  const sample = async () => {
    if (disabled || sampling) return;
    setSampling(true);
    onInteractionStart?.();
    const sampled = await sampleScreenColor();
    setSampling(false);
    if (!sampled) {
      onInteractionCancel?.();
      return;
    }
    onChange(sampled);
    onInteractionCommit?.();
  };

  const togglePicker = () => {
    if (disabled) return;
    if (onActivate) {
      onActivate();
      return;
    }
    if (presentedOpen) close(true);
    else {
      openingValueRef.current = value;
      onInteractionStart?.();
      setOpen(true);
    }
  };

  return (
    <>
      <PaintField ref={triggerRef} kind="color" value={value} size={size} className={className}
        ariaLabel={ariaLabel} disabled={disabled} tabIndex={tabIndex} expanded={presentedOpen} sampling={sampling}
        onClick={togglePicker} onSample={accessory === 'sampler' ? () => void sample() : undefined} />
      {open && !onActivate ? createPortal(
        <div ref={popoverRef} className="color-swatch-field__popover"
          data-ui-component="color-popover" data-ui-theme={triggerRef.current?.closest('[data-ui-theme]')?.getAttribute('data-ui-theme') ?? undefined}
          data-editor-floating-control style={position}>
          <ColorPicker value={colorPickerParseHex(value) ?? { r: 0, g: 0, b: 0, a: 1 }}
            onChange={(color) => onChange(colorPickerHex(color).toLowerCase())} />
        </div>, document.body
      ) : null}
    </>
  );
};
