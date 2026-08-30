import { Button } from '@lighttable/ui';
import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { NumericExpressionInput } from '../../../ui/NumericExpressionInput';
import { useDialogAccessibility } from '../../../ui/useDialogAccessibility';

export interface ArbitraryRotationDialogProps {
  readonly open: boolean;
  readonly busy?: boolean;
  readonly onCancel: () => void;
  readonly onCommit: (degrees: number) => void;
}

export const ArbitraryRotationDialog = ({ open, busy = false, onCancel, onCommit }: ArbitraryRotationDialogProps) => {
  const [degrees, setDegrees] = useState(0);
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLFormElement>(open, onCancel);
  useLayoutEffect(() => { if (open) setDegrees(0); }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop lighttable-dialog-backdrop" onMouseDown={onCancel}>
      <form ref={dialogRef} className="modal text-input-dialog--compact" role="dialog" aria-modal="true"
        aria-label="Arbitrary Rotation" tabIndex={-1} data-editor-native-tab-navigation
        onMouseDown={(event) => event.stopPropagation()} onKeyDown={onDialogKeyDown}
        onSubmit={(event) => { event.preventDefault(); if (!busy && Number.isFinite(degrees)) onCommit(degrees); }}>
        <div className="modal__header"><h3 className="modal__title">Rotate Canvas</h3></div>
        <label className="lighttable-ui-guide__dialog-field"><span>Angle (clockwise)</span>
          <NumericExpressionInput autoFocus value={degrees} kind="float" step={0.1}
            onValueChange={setDegrees} aria-label="Clockwise rotation angle" /></label>
        <div className="modal__footer">
          <Button tabIndex={0} data-ui-theme="dark" onClick={onCancel}>Cancel</Button>
          <Button tabIndex={0} data-ui-theme="dark" type="submit" disabled={busy || !Number.isFinite(degrees)}>{busy ? 'Applying…' : 'OK'}</Button>
        </div>
      </form>
    </div>, globalThis.document.body
  );
};
