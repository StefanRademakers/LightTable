import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LightTableImageClipboard } from '../platform/LightTableImageClipboard';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { useDialogAccessibility } from '../ui/useDialogAccessibility';

interface NewDocumentDialogProps {
  readonly open: boolean;
  readonly clipboard?: LightTableImageClipboard;
  readonly creating: boolean;
  readonly onCancel: () => void;
  readonly onCreate: (size: { width: number; height: number }) => void;
}

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const MAX_DIMENSION = 16384;

const readClipboardDimensions = async (
  clipboard: LightTableImageClipboard | undefined
) => {
  if (!clipboard) return null;
  const image = await clipboard.readImage();
  if (!image) return null;
  if (image.placement) {
    return {
      width: image.placement.width,
      height: image.placement.height
    };
  }
  const bitmap = await createImageBitmap(image.blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
};

export function NewDocumentDialog({
  open,
  clipboard,
  creating,
  onCancel,
  onCreate
}: NewDocumentDialogProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const requestRef = useRef(0);
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLFormElement>(open, onCancel);

  useEffect(() => {
    if (!open) return;
    const request = ++requestRef.current;
    setWidth(DEFAULT_WIDTH);
    setHeight(DEFAULT_HEIGHT);
    void readClipboardDimensions(clipboard)
      .then((dimensions) => {
        if (request !== requestRef.current || !dimensions) return;
        setWidth(dimensions.width);
        setHeight(dimensions.height);
      })
      // Clipboard access can be denied or unsupported. New document remains
      // fully usable with stable defaults in that case.
      .catch(() => undefined);
    return () => {
      requestRef.current += 1;
    };
  }, [clipboard, open]);

  if (!open) return null;
  const normalizedWidth = Math.round(width);
  const normalizedHeight = Math.round(height);
  const valid = Number.isFinite(normalizedWidth)
    && Number.isFinite(normalizedHeight)
    && normalizedWidth >= 1
    && normalizedHeight >= 1
    && normalizedWidth <= MAX_DIMENSION
    && normalizedHeight <= MAX_DIMENSION;

  return createPortal(
    <div className="modal-backdrop lighttable-dialog-backdrop">
      <form
        ref={dialogRef}
        className="modal lighttable-new-document-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="New document"
        tabIndex={-1}
        data-editor-native-tab-navigation
        onKeyDown={onDialogKeyDown}
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !creating) {
            onCreate({ width: normalizedWidth, height: normalizedHeight });
          }
        }}
      >
        <div className="modal__header">
          <h3 className="modal__title">New document</h3>
        </div>
        <div className="lighttable-new-document-dialog__fields">
          <label>
            <span>Width</span>
            <FormInput
              autoFocus
              type="number"
              inputMode="numeric"
              min="1"
              max={MAX_DIMENSION}
              value={width}
              onChange={(event) => setWidth(event.currentTarget.valueAsNumber)}
            />
          </label>
          <label>
            <span>Height</span>
            <FormInput
              type="number"
              inputMode="numeric"
              min="1"
              max={MAX_DIMENSION}
              value={height}
              onChange={(event) => setHeight(event.currentTarget.valueAsNumber)}
            />
          </label>
        </div>
        <div className="modal__footer">
          <ActionButton onClick={onCancel}>Cancel</ActionButton>
          <ActionButton type="submit" disabled={!valid || creating}>
            {creating ? 'Creating…' : 'Create'}
          </ActionButton>
        </div>
      </form>
    </div>,
    document.body
  );
}
