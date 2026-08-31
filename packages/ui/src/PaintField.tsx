import React from 'react';
import { MaskIcon } from './MaskIcon';
import { pipetteIconUrl } from './icons';

export interface PaintFieldProps {
  kind: 'color' | 'gradient' | 'none';
  /** CSS color or gradient, used for the preview only. */
  value?: string;
  ariaLabel: string;
  title?: string;
  size?: 'compact' | 'chip';
  expanded?: boolean;
  disabled?: boolean;
  sampling?: boolean;
  tabIndex?: number;
  className?: string;
  onClick: () => void;
  /** When supplied, replaces the chevron with a separate sampling action. */
  onSample?: () => void;
}

/** A paint preview and opener, not a value editor. The host owns its popup. */
export const PaintField = React.forwardRef<HTMLButtonElement, PaintFieldProps>(function PaintField({
  kind, value, ariaLabel, title = ariaLabel, size = 'compact',
  expanded = false, disabled = false, sampling = false, tabIndex = -1, className = '', onClick, onSample
}, ref) {
  const root = {
    className: `ui-paint-field${className ? ` ${className}` : ''}`,
    'data-ui-component': 'paint-field',
    'data-suite-control': kind === 'color' ? 'color-swatch' : kind === 'gradient' ? 'gradient-field' : 'none-paint',
    'data-suite-variant': size,
    'data-size': size,
    'data-disabled': disabled || undefined,
    'data-expanded': expanded || undefined,
    title
  };
  const opener = { ref, type: 'button' as const, disabled, tabIndex,
    'aria-label': ariaLabel, 'aria-haspopup': 'dialog' as const, 'aria-expanded': expanded, onClick };
  const preview = <span className="ui-paint-field__preview" data-kind={kind} aria-hidden="true"
    style={kind === 'none' ? undefined : { '--ui-paint-preview': kind === 'color'
      ? `linear-gradient(${value}, ${value})` : value } as React.CSSProperties} />;

  if (onSample && size !== 'chip') return <span {...root}>
    <button {...opener} className="ui-paint-field__well">{preview}</button>
    <button type="button" className="ui-paint-field__accessory" tabIndex={tabIndex}
      disabled={disabled || sampling} aria-label={`Sample ${ariaLabel.toLowerCase()}`}
      title={`Sample ${ariaLabel.toLowerCase()}`} onClick={onSample}>
      <MaskIcon src={pipetteIconUrl} />
    </button>
  </span>;

  return <button {...root} {...opener}>
    {preview}
    {size !== 'chip' && <span className="ui-paint-field__accessory" aria-hidden="true"><span className="ui-paint-field__chevron" /></span>}
  </button>;
});
