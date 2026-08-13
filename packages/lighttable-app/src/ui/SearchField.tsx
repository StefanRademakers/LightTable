import { forwardRef, type InputHTMLAttributes } from 'react';
import { lightTableIcon } from '../assets/icons';

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Shows the canonical trailing clear action while the controlled value is non-empty. */
  readonly onClear?: () => void;
  readonly clearLabel?: string;
}

/** Canonical compact search input for panels, dialogs and asset browsers. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { className, onClear, clearLabel = 'Clear search', value, ...props },
  ref
) {
  const rootClassName = className ? `lighttable-search-field ${className}` : 'lighttable-search-field';
  const hasValue = String(value ?? '').length > 0;
  return <div className={rootClassName}>
    <img src={lightTableIcon('search.png')} alt="" aria-hidden="true" />
    <input ref={ref} type="search" value={value} {...props} />
    {hasValue && onClear ? <button type="button" className="lighttable-search-field__clear"
      aria-label={clearLabel} title={clearLabel} onClick={onClear}>
      <img src={lightTableIcon('close.png')} alt="" aria-hidden="true" />
    </button> : null}
  </div>;
});
