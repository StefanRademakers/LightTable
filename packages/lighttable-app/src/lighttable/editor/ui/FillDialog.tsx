import React from 'react';
import { ConfirmDialog } from '../../../ui/ConfirmDialog';
import { ToolOptionSelect } from './ToolOptionControls';

export interface FillDialogProps {
  readonly open: boolean;
  readonly foregroundColor: string;
  readonly backgroundColor: string;
  readonly onCancel: () => void;
  readonly onFill: (color: string, preserveTransparency: boolean) => void;
}

export const FillDialog = ({
  open,
  foregroundColor,
  backgroundColor,
  onCancel,
  onFill
}: FillDialogProps) => {
  const [source, setSource] = React.useState<'foreground' | 'background'>('foreground');
  const [preserveTransparency, setPreserveTransparency] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setSource('foreground');
    setPreserveTransparency(false);
  }, [open]);

  return (
    <ConfirmDialog
      open={open}
      title="Fill"
      confirmLabel="Fill"
      onCancel={onCancel}
      onConfirm={() => {
        onCancel();
        onFill(source === 'foreground' ? foregroundColor : backgroundColor, preserveTransparency);
      }}
    >
      <div className="lighttable-tool-options__content lighttable-tool-options__content--vertical">
        <ToolOptionSelect
          label="Contents"
          aria-label="Fill contents"
          value={source}
          onChange={(event) => setSource(event.currentTarget.value as typeof source)}
        >
          <option value="foreground">Foreground color</option>
          <option value="background">Background color</option>
        </ToolOptionSelect>
        <label className="lighttable-tool-options__toggle">
          <input
            type="checkbox"
            checked={preserveTransparency}
            onChange={(event) => setPreserveTransparency(event.currentTarget.checked)}
          />
          <span>Preserve transparency</span>
        </label>
      </div>
    </ConfirmDialog>
  );
};
