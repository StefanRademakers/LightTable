import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LightTableProjectLocation } from '../platform/LightTableHost';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { useDialogAccessibility } from '../ui/useDialogAccessibility';

interface NewProjectDialogProps {
  readonly open: boolean;
  readonly creating: boolean;
  readonly location: LightTableProjectLocation | null;
  readonly error: string | null;
  readonly onChooseLocation: () => void;
  readonly onCancel: () => void;
  readonly onCreate: (name: string) => void;
}

export function NewProjectDialog({
  open, creating, location, error, onChooseLocation, onCancel, onCreate
}: NewProjectDialogProps) {
  const [name, setName] = useState('Untitled Project');
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLFormElement>(open, onCancel);

  useEffect(() => {
    if (open) setName('Untitled Project');
  }, [open]);

  if (!open) return null;
  const valid = Boolean(name.trim() && location && !creating);
  return createPortal(
    <div className="modal-backdrop lighttable-dialog-backdrop">
      <form
        ref={dialogRef}
        className="modal lighttable-new-document-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="New project"
        tabIndex={-1}
        data-editor-native-tab-navigation
        onKeyDown={onDialogKeyDown}
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onCreate(name.trim());
        }}
      >
        <div className="modal__header"><h3 className="modal__title">New project</h3></div>
        <div className="lighttable-new-document-dialog__fields">
          <label className="lighttable-new-document-dialog__wide-field">
            <span>Name</span>
            <FormInput autoFocus value={name} maxLength={255}
              onChange={(event) => setName(event.currentTarget.value)} />
          </label>
          <div className="lighttable-new-document-dialog__wide-field">
            <span className="lighttable-project-dialog__label">Location</span>
            <div className="lighttable-preferences__location-row">
              <div className="lighttable-preferences__location" title={location?.path}>
                {location?.label ?? 'Choose a parent folder'}
              </div>
              <ActionButton type="button" onClick={onChooseLocation}>Choose...</ActionButton>
            </div>
          </div>
          {error ? <p className="lighttable-file-drop__error lighttable-new-document-dialog__wide-field" role="alert">{error}</p> : null}
        </div>
        <div className="modal__footer">
          <ActionButton type="button" onClick={onCancel}>Cancel</ActionButton>
          <ActionButton type="submit" disabled={!valid}>{creating ? 'Creating...' : 'Create'}</ActionButton>
        </div>
      </form>
    </div>,
    document.body
  );
}
