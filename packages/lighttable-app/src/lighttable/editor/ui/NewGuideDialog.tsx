import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from '../../../ui/ActionButton';
import { NumericExpressionInput } from '../../../ui/NumericExpressionInput';
import { FormSelect } from '../../../ui/FormSelect';
import { useDialogAccessibility } from '../../../ui/useDialogAccessibility';
import type { DocumentGuide } from '../document/documentTypes';

interface Props {
  open: boolean;
  onCancel: () => void;
  onCommit: (guide: Omit<DocumentGuide, 'id'>) => void;
}

export const NewGuideDialog = ({ open, onCancel, onCommit }: Props) => {
  const [orientation, setOrientation] = useState<DocumentGuide['orientation']>('vertical');
  const [position, setPosition] = useState(0);
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLFormElement>(open, onCancel);
  useEffect(() => {
    if (!open) return;
    setOrientation('vertical');
    setPosition(0);
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop lighttable-dialog-backdrop" onMouseDown={onCancel}>
      <form ref={dialogRef} className="modal text-input-dialog text-input-dialog--compact"
        role="dialog" aria-modal="true" aria-label="New Guide" tabIndex={-1}
        data-editor-native-tab-navigation onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onDialogKeyDown} onSubmit={(event) => {
          event.preventDefault();
          if (!Number.isFinite(position)) return;
          onCommit({ orientation, position });
        }}>
        <div className="modal__header"><h3 className="modal__title">New Guide</h3></div>
        <label className="lighttable-guide-dialog__row"><span>Orientation</span>
          <FormSelect value={orientation}
            onChange={(event) => setOrientation(event.currentTarget.value as DocumentGuide['orientation'])}>
            <option value="vertical">Vertical</option><option value="horizontal">Horizontal</option>
          </FormSelect>
        </label>
        <label className="lighttable-guide-dialog__row"><span>Position</span>
          <NumericExpressionInput kind="float" value={position} step={1}
            onValueChange={setPosition} />
          <span>px</span>
        </label>
        <div className="modal__footer">
          <ActionButton onClick={onCancel}>Cancel</ActionButton>
          <ActionButton type="submit">OK</ActionButton>
        </div>
      </form>
    </div>,
    globalThis.document.body
  );
};
