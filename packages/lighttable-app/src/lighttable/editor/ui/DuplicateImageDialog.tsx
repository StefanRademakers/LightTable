import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from '../../../ui/ActionButton';
import { FormInput } from '../../../ui/FormInput';
import { useDialogAccessibility } from '../../../ui/useDialogAccessibility';
import {
  duplicateDocumentDefaultName,
  normalizeDuplicateDocumentName
} from '../../application/documents/duplicateLayeredDocumentArtifact';

export interface DuplicateImageDialogProps {
  readonly open: boolean;
  readonly sourceName: string;
  readonly busy: boolean;
  readonly error?: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: (name: string) => void;
}

export const DuplicateImageDialog = ({
  open,
  sourceName,
  busy,
  error,
  onCancel,
  onConfirm
}: DuplicateImageDialogProps) => {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLFormElement>(open, onCancel);

  useEffect(() => {
    if (!open) return;
    setName(duplicateDocumentDefaultName(sourceName));
  }, [open, sourceName]);

  useEffect(() => {
    if (!open || name !== duplicateDocumentDefaultName(sourceName)) return;
    const frame = requestAnimationFrame(() => inputRef.current?.select());
    return () => cancelAnimationFrame(frame);
  }, [name, open, sourceName]);

  if (!open) return null;
  let normalizedName: string | null = null;
  try { normalizedName = normalizeDuplicateDocumentName(name, sourceName); } catch { /* validation below */ }

  return createPortal(
    <div className="modal-backdrop lighttable-dialog-backdrop">
      <form
        ref={dialogRef}
        className="modal lighttable-new-document-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Duplicate Image"
        tabIndex={-1}
        data-editor-native-tab-navigation
        onKeyDown={onDialogKeyDown}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && normalizedName) onConfirm(normalizedName);
        }}
      >
        <div className="modal__header"><h3 className="modal__title">Duplicate Image</h3></div>
        <div className="lighttable-new-document-dialog__fields">
          <div className="lighttable-new-document-dialog__wide-field">
            <span>Duplicate</span>
            <strong title={sourceName}>{sourceName}</strong>
          </div>
          <label className="lighttable-new-document-dialog__wide-field">
            <span>As</span>
            <FormInput ref={inputRef} value={name} maxLength={255}
              aria-invalid={!normalizedName}
              onChange={(event) => setName(event.currentTarget.value)} />
          </label>
          {error ? <p className="lighttable-file-drop__error lighttable-new-document-dialog__wide-field" role="alert">{error}</p> : null}
        </div>
        <div className="modal__footer">
          <ActionButton type="button" onClick={onCancel} disabled={busy}>Cancel</ActionButton>
          <ActionButton type="submit" disabled={busy || !normalizedName}>{busy ? 'Duplicating...' : 'OK'}</ActionButton>
        </div>
      </form>
    </div>,
    document.body
  );
};
