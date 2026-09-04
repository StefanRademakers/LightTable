import { Button, Dialog, PathField, Text } from '@lighttable/ui';
import type { LightTableProjectLocation } from '../platform/LightTableHost';

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
  const valid = Boolean(location && !creating);
  return (
    <Dialog open={open} as="form" title="Create Project" aria-label="Create project"
      onDismiss={creating ? () => undefined : onCancel}
      onSubmit={(event) => {
          event.preventDefault();
          if (valid) onCreate();
        }} footer={<>
          <Button tabIndex={0} type="button" onClick={onCancel} disabled={creating}>Cancel</Button>
          <Button tabIndex={0} type="submit" disabled={!valid}>{creating ? 'Creating...' : 'Create'}</Button>
        </>}>
        <div className="lighttable-new-document-dialog__fields">
          <label className="lighttable-new-document-dialog__wide-field">
            <span>Project folder</span>
            <PathField tabIndex={0} readOnly inputAriaLabel="Project folder" value={location?.path ?? ''}
              placeholder="Choose a project folder" title={location?.path} buttonLabel="Choose…"
              autoFocusButton={!location} onBrowse={onChooseLocation} />
          </label>
          <Text className="lighttable-new-document-dialog__wide-field" tone="muted">
            LightTable project files will be added to this folder. Existing files are kept.
          </Text>
          {error ? <Text className="lighttable-file-drop__error lighttable-new-document-dialog__wide-field" role="alert">{error}</Text> : null}
        </div>
    </Dialog>
  );
}
