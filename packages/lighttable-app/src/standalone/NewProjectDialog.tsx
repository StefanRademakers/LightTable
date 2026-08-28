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
  readonly onCreate: () => void;
}

export function NewProjectDialog({
  open, creating, location, error, onChooseLocation, onCancel, onCreate
}: NewProjectDialogProps) {
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLFormElement>(open, onCancel);

  if (!open) return null;
  const valid = Boolean(location && !creating);
  return createPortal(
    <div className="modal-backdrop lighttable-dialog-backdrop">
      <form
        ref={dialogRef}
        className="modal lighttable-new-document-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Create project"
        tabIndex={-1}
        data-editor-native-tab-navigation
        onKeyDown={onDialogKeyDown}
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onCreate();
        }}
      >
        <div className="modal__header"><h3 className="modal__title">Create Project</h3></div>
        <div className="lighttable-new-document-dialog__fields">
          <label className="lighttable-new-document-dialog__wide-field">
            <span>Project folder</span>
            <div className="lighttable-preferences__location-row">
              <FormInput readOnly aria-label="Project folder" value={location?.path ?? ''}
                placeholder="Choose a project folder" title={location?.path} />
              <ActionButton type="button" autoFocus={!location} onClick={onChooseLocation}>Choose...</ActionButton>
            </div>
          </label>
          <p className="lighttable-preferences__note lighttable-new-document-dialog__wide-field">
            LightTable project files will be added to this folder. Existing files are kept.
          </p>
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
