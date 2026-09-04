import { Button, Dialog, FieldRow, NumberField, Select } from '@lighttable/ui';
import { useEffect, useState } from 'react';
import type { DocumentGuide } from '../document/documentTypes';

interface Props {
  open: boolean;
  onCancel: () => void;
  onCommit: (guide: Omit<DocumentGuide, 'id'>) => void;
}

export const NewGuideDialog = ({ open, onCancel, onCommit }: Props) => {
  const [orientation, setOrientation] = useState<DocumentGuide['orientation']>('vertical');
  const [position, setPosition] = useState(0);
  useEffect(() => {
    if (!open) return;
    setOrientation('vertical');
    setPosition(0);
  }, [open]);
  return (
    <Dialog open={open} as="form" size="compact" title="New Guide" onDismiss={onCancel}
      onSubmit={(event) => {
          event.preventDefault();
          if (!Number.isFinite(position)) return;
          onCommit({ orientation, position });
        }} footer={<>
          <Button tabIndex={0} onClick={onCancel}>Cancel</Button>
          <Button tabIndex={0} type="submit">OK</Button>
        </>}>
        <FieldRow label="Orientation">
          <Select tabIndex={0} value={orientation}
            onValueChange={(nextValue) => setOrientation(nextValue as DocumentGuide['orientation'])}>
            <option value="vertical">Vertical</option><option value="horizontal">Horizontal</option>
          </Select>
        </FieldRow>
        <FieldRow label="Position (px)">
          <NumberField tabIndex={0} kind="float" value={position} step={1}
            onValueChange={setPosition} />
        </FieldRow>
    </Dialog>
  );
};
