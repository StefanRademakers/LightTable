import { Checkbox, Button, Dialog, TextInput } from '@lighttable/ui';
import React, { useEffect, useRef, useState } from 'react';

interface TextInputDialogProps {
  open: boolean;
  title: string;
  description?: string;
  initialValue?: string;
  placeholder?: string;
  okLabel?: string;
  cancelLabel?: string;
  selectAllOnOpen?: boolean;
  compact?: boolean;
  backdropClassName?: string;
  checkboxLabel?: string;
  checkboxChecked?: boolean;
  onCheckboxChange?: (checked: boolean) => void;
  onCancel: () => void;
  onConfirm: (value: string) => void | Promise<void>;
}

export const TextInputDialog: React.FC<TextInputDialogProps> = ({
  open,
  title,
  description,
  initialValue = '',
  placeholder,
  okLabel = 'OK',
  cancelLabel = 'Cancel',
  selectAllOnOpen = false,
  compact = false,
  backdropClassName,
  checkboxLabel,
  checkboxChecked = false,
  onCheckboxChange,
  onCancel,
  onConfirm
}) => {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
  }, [open, initialValue]);

  useEffect(() => {
    if (!open || !selectAllOnOpen) return;
    window.setTimeout(() => inputRef.current?.select(), 0);
  }, [open, selectAllOnOpen]);

  return <Dialog
    open={open}
    title={title}
    description={description}
    size={compact ? 'compact' : 'regular'}
    onDismiss={onCancel}
    backdropClassName={backdropClassName}
    data-suite-control="text-input-dialog"
    footer={<>
      <Button tabIndex={0} onClick={onCancel}>{cancelLabel}</Button>
      <Button tabIndex={0} disabled={!value.trim()} onClick={() => void onConfirm(value.trim())}>
        {okLabel}
      </Button>
    </>}
  >
    <TextInput tabIndex={0}
      ref={inputRef}
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          void onConfirm(value.trim());
        }
      }}
    />
    {checkboxLabel ? <label className="text-input-dialog__check">
      <Checkbox tabIndex={0} checked={checkboxChecked}
        onChange={(event) => onCheckboxChange?.(event.currentTarget.checked)} />
      <span>{checkboxLabel}</span>
    </label> : null}
  </Dialog>;
};
