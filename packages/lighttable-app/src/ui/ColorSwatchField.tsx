import React from 'react';
import { createPortal } from 'react-dom';
import { lightTableIcon } from '../assets/icons';
import { ColorPicker, colorPickerHex, colorPickerParseHex } from './ColorPicker';
import { sampleScreenColor } from './colorSampling';

export { sampleScreenColor } from './colorSampling';

const POPOVER_GAP = 6;
export const colorPickerPopoverPosition = (
  trigger: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
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
  readonly size?: 'regular' | 'compact' | 'chip';
  readonly className?: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
  readonly onInteractionStart?: () => void;
  readonly onInteractionCommit?: () => void;
  readonly onInteractionCancel?: () => void;
}

/** Canonical solid-color editor: one value shared by manual and sampled input. */
export const ColorSwatchField: React.FC<ColorSwatchFieldProps> = ({
  value,
  ariaLabel,
  size = 'regular',
  className,
  disabled = false,
  onChange,
  onInteractionStart,
  onInteractionCommit,
  onInteractionCancel
}) => {
  const [sampling, setSampling] = React.useState(false);
  const [open, setOpen] = React.useState(false);
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
    const update = () => setPosition(colorPickerPopoverPosition(
      triggerRef.current!.getBoundingClientRect(), popoverRef.current!.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight }
    ));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(true);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
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

  return (
    <span className={`color-swatch-field color-swatch-field--${size}${className ? ` ${className}` : ''}`}>
      <button ref={triggerRef} type="button" className="color-swatch-field__well"
        style={{ backgroundColor: value }} disabled={disabled} aria-label={ariaLabel}
        aria-haspopup="dialog" aria-expanded={open} onClick={() => {
          if (open) close(true);
          else {
            openingValueRef.current = value;
            onInteractionStart?.();
            setOpen(true);
          }
        }} />
      {size !== 'chip' ? <button type="button" className="color-swatch-field__sampler"
        disabled={disabled || sampling} aria-label={`Sample ${ariaLabel.toLowerCase()}`}
        title={`Sample ${ariaLabel.toLowerCase()}`} onClick={() => void sample()}>
        <img src={lightTableIcon('tool_sample_color.png')} alt="" aria-hidden="true" />
      </button> : null}
      {open ? createPortal(
        <div ref={popoverRef} className="color-swatch-field__popover" style={position}>
          <ColorPicker value={colorPickerParseHex(value) ?? { r: 0, g: 0, b: 0, a: 1 }}
            onChange={(color) => onChange(colorPickerHex(color).toLowerCase())} />
        </div>, document.body
      ) : null}
    </span>
  );
};
