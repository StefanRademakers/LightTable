import React from 'react';

export interface NonePaintFieldProps {
  readonly ariaLabel: string;
  readonly title?: string;
  readonly expanded?: boolean;
  readonly size?: 'regular' | 'compact';
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

/** Canonical paint-field trigger for selecting or editing an unpainted value. */
export const NonePaintField = React.forwardRef<HTMLButtonElement, NonePaintFieldProps>(
  ({
    ariaLabel,
    title = ariaLabel,
    expanded = false,
    size = 'regular',
    disabled = false,
    onClick
  }, ref) => (
    <button ref={ref} type="button"
      className={`none-paint-field none-paint-field--${size}`}
      data-suite-control="none-paint" data-suite-variant={size}
      aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={expanded}
      title={title} disabled={disabled} onClick={onClick}>
      <span className="none-paint-field__preview" aria-hidden="true" />
      <span className="paint-field__arrow" aria-hidden="true" />
    </button>
  )
);

NonePaintField.displayName = 'NonePaintField';
