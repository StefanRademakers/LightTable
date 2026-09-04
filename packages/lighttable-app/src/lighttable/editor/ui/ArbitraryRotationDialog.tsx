import { Button, Dialog, FieldRow, NumberField } from '@lighttable/ui';
import { useLayoutEffect, useState } from 'react';

export interface ArbitraryRotationDialogProps {
  readonly open: boolean;
  readonly busy?: boolean;
  readonly onCancel: () => void;
  readonly onCommit: (degrees: number) => void;
}

export const ArbitraryRotationDialog = ({ open, busy = false, onCancel, onCommit }: ArbitraryRotationDialogProps) => {
  const [degrees, setDegrees] = useState(0);
  useLayoutEffect(() => { if (open) setDegrees(0); }, [open]);
  return (
    <Dialog open={open} as="form" size="compact" title="Rotate Canvas" aria-label="Arbitrary Rotation"
      onDismiss={busy ? () => undefined : onCancel}
      onSubmit={(event) => { event.preventDefault(); if (!busy && Number.isFinite(degrees)) onCommit(degrees); }}
      footer={<>
        <Button tabIndex={0} onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button tabIndex={0} type="submit" disabled={busy || !Number.isFinite(degrees)}>{busy ? 'Applying…' : 'OK'}</Button>
      </>}>
        <FieldRow label="Angle (clockwise)" layout="column">
          <NumberField tabIndex={0} autoFocus value={degrees} kind="float" step={0.1}
            onValueChange={setDegrees} aria-label="Clockwise rotation angle" />
        </FieldRow>
    </Dialog>
  );
};
