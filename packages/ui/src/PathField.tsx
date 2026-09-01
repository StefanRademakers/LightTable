import type { ChangeEventHandler } from 'react';
import { Button } from './Button';
import { TextInput } from './TextInput';

export interface PathFieldProps {
  value: string;
  onBrowse: () => void;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  buttonLabel?: string;
  inputAriaLabel?: string;
  placeholder?: string;
  title?: string;
  readOnly?: boolean;
  disabled?: boolean;
  autoFocusButton?: boolean;
  tabIndex?: number;
}

/** A path value and its browse action. The host owns the filesystem picker. */
export function PathField({
  value,
  onBrowse,
  onChange,
  buttonLabel = 'Browse…',
  inputAriaLabel = 'Path',
  placeholder,
  title,
  readOnly = false,
  disabled = false,
  autoFocusButton = false,
  tabIndex = -1
}: PathFieldProps) {
  return <div className="ui-path-field" data-ui-component="path-field" data-suite-control="path-field">
    <TextInput
      aria-label={inputAriaLabel}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      title={title}
      readOnly={readOnly}
      disabled={disabled}
      tabIndex={tabIndex}
    />
    <Button disabled={disabled} autoFocus={autoFocusButton} tabIndex={tabIndex} onClick={onBrowse}>
      {buttonLabel}
    </Button>
  </div>;
}
