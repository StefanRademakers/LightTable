import { Button, Dialog, FieldRow, TextInput } from '@lighttable/ui';
import React, { useRef } from 'react';

interface PointTextCreationDialogProps {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export const PointTextCreationDialog: React.FC<PointTextCreationDialogProps> = ({
  value,
  onChange,
  onCommit,
  onCancel
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <Dialog open as="form" title="Create text" onDismiss={onCancel}
      onSubmit={(event) => {
          event.preventDefault();
          onCommit();
        }} footer={<>
          <Button tabIndex={0} type="button" onClick={onCancel}>Cancel</Button>
          <Button tabIndex={0} type="submit" disabled={!value.length}>Create</Button>
        </>}>
        <FieldRow label="Text" layout="column">
          <TextInput tabIndex={0} autoFocus
            ref={inputRef}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        </FieldRow>
    </Dialog>
  );
};
