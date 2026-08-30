import { Button } from '@lighttable/ui';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { FormInput } from './FormInput';
import { useDialogAccessibility } from './useDialogAccessibility';

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
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLDivElement>(open, onCancel);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
  }, [open, initialValue]);

  useEffect(() => {
    if (!open || !selectAllOnOpen) return;
    window.setTimeout(() => inputRef.current?.select(), 0);
  }, [open, selectAllOnOpen]);

  if (!open) return null;

  return createPortal(
    <div className={`modal-backdrop${backdropClassName ? ` ${backdropClassName}` : ''}`}>
      <div
        ref={dialogRef}
        className={`modal text-input-dialog${compact ? ' text-input-dialog--compact' : ''}`}
        data-suite-control="text-input-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-editor-native-tab-navigation
        onKeyDown={onDialogKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <h3 className="modal__title">{title}</h3>
        </div>
        {description ? <p className="muted">{description}</p> : null}
        <FormInput
          ref={inputRef}
          className="text-input-dialog__input"
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
          <input
            type="checkbox"
            checked={checkboxChecked}
            onChange={(event) => onCheckboxChange?.(event.currentTarget.checked)}
          />
          <span>{checkboxLabel}</span>
        </label> : null}
        <div className="modal__footer">
          <Button tabIndex={0} onClick={onCancel}>{cancelLabel}</Button>
          <Button tabIndex={0}
            disabled={!value.trim()}
            onClick={() => void onConfirm(value.trim())}
          >
            {okLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};
