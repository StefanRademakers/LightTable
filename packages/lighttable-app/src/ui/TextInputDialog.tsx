import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from './ActionButton';
import { FormInput } from './FormInput';

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

  if (!open) return null;

  return createPortal(
    <div className={`modal-backdrop${backdropClassName ? ` ${backdropClassName}` : ''}`}>
      <div
        className={`modal text-input-dialog${compact ? ' text-input-dialog--compact' : ''}`}
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
        <div className="modal__footer">
          <ActionButton onClick={onCancel}>{cancelLabel}</ActionButton>
          <ActionButton
            disabled={!value.trim()}
            onClick={() => void onConfirm(value.trim())}
          >
            {okLabel}
          </ActionButton>
        </div>
      </div>
    </div>,
    document.body
  );
};
