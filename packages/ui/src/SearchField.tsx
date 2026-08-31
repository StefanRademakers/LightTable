import { forwardRef, type InputHTMLAttributes } from 'react';
import { IconButton } from './IconButton';
import { MaskIcon } from './MaskIcon';
import { TextInput } from './TextInput';
import { closeIconUrl, searchIconUrl } from './icons';

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  onClear?: () => void;
  clearLabel?: string;
}

/** A native search field with shared geometry and optional controlled clear action. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { className = '', onClear, clearLabel = 'Clear search', value, disabled, readOnly, tabIndex = -1, style, ...props }, ref
) {
  const showClear = Boolean(onClear && String(value ?? '').length);
  return <div className={`ui-search-field ${className}`} style={style} data-suite-control="search-field"
    data-ui-component="search-field" data-clear={showClear || undefined}>
    <TextInput {...props} ref={ref} type="search" value={value} disabled={disabled} readOnly={readOnly} tabIndex={tabIndex} />
    <MaskIcon src={searchIconUrl} className="ui-search-field__icon" />
    {showClear ? <IconButton className="ui-search-field__clear" variant="quiet"
      aria-label={clearLabel} title={clearLabel} tabIndex={tabIndex} disabled={disabled || readOnly}
      icon={<MaskIcon src={closeIconUrl} />}
      onPointerDown={event => event.preventDefault()} onClick={onClear} /> : null}
  </div>;
});
