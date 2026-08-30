import { Button } from '@lighttable/ui';
import React, { type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useDialogAccessibility } from './useDialogAccessibility';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  danger = false,
  children,
  onCancel,
  onConfirm
}) => {
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLDivElement>(open, onCancel);
  if (!open) return null;

  return createPortal(
    <div className="modal-backdrop modal-backdrop--confirm">
      <div ref={dialogRef} className="modal text-input-dialog" role="dialog" aria-modal="true" aria-label={title}
        data-suite-control="confirm-dialog"
        tabIndex={-1} data-editor-native-tab-navigation onKeyDown={onDialogKeyDown} onClick={(event) => event.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">{title}</h3>
        </div>
        {description ? <p className="muted">{description}</p> : null}
        {children}
        <div className="modal__footer">
          <Button tabIndex={0} data-ui-theme="dark" onClick={onCancel}>{cancelLabel}</Button>
          <Button tabIndex={0} data-ui-theme="dark" intent={danger ? "destructive" : "normal"} onClick={() => void onConfirm()}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};

