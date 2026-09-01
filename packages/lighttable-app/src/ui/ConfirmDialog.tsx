import { Button, Dialog } from '@lighttable/ui';
import React, { type ReactNode } from 'react';

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
  return <Dialog
    open={open}
    title={title}
    description={description}
    onDismiss={onCancel}
    backdropClassName="modal-backdrop--confirm"
    data-suite-control="confirm-dialog"
    footer={<>
      <Button tabIndex={0} onClick={onCancel}>{cancelLabel}</Button>
      <Button tabIndex={0} intent={danger ? 'destructive' : 'normal'} onClick={() => void onConfirm()}>
        {confirmLabel}
      </Button>
    </>}
  >{children}</Dialog>;
};

