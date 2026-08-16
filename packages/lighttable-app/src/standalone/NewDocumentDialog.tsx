import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LightTableImageClipboard } from '../platform/LightTableImageClipboard';
import { ActionButton } from '../ui/ActionButton';
import { FormInput } from '../ui/FormInput';
import { FormSelect } from '../ui/FormSelect';
import { ColorSwatchField } from '../ui/ColorSwatchField';
import { useDialogAccessibility } from '../ui/useDialogAccessibility';
import type { LightTableCreateDocumentOptions } from '../lighttable/application/commands/lightTableCommandService';
import {
  documentBlendProfileDescription,
  documentBlendProfileDisplayName
} from '../lighttable/editor/color/documentColorTransform';

interface NewDocumentDialogProps {
  readonly open: boolean;
  readonly clipboard?: LightTableImageClipboard;
  readonly creating: boolean;
  readonly onCancel: () => void;
  readonly onCreate: (options: LightTableCreateDocumentOptions) => void;
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
  const [name, setName] = useState('Untitled');
  const [resolutionPpi, setResolutionPpi] = useState(72);
  const [bitDepth, setBitDepth] = useState<8 | 16>(8);
  const [profile, setProfile] = useState<'srgb' | 'adobe-rgb-1998'>('srgb');
  const [backgroundKind, setBackgroundKind] = useState<'transparent' | 'solid'>('transparent');
  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const requestRef = useRef(0);
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLFormElement>(open, onCancel);

  useEffect(() => {
    if (!open) return;
    const request = ++requestRef.current;
    setWidth(DEFAULT_WIDTH);
    setHeight(DEFAULT_HEIGHT);
    setName('Untitled');
    setResolutionPpi(72);
    setBitDepth(8);
    setProfile('srgb');
    setBackgroundKind('transparent');
    setBackgroundColor('#ffffff');
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
  const optionsValid = valid && name.trim().length > 0 && name.trim().length <= 255
    && Number.isFinite(resolutionPpi) && resolutionPpi >= 1 && resolutionPpi <= 2400;

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
          if (optionsValid && !creating) {
            onCreate({
              name: name.trim(), width: normalizedWidth, height: normalizedHeight,
              resolutionPpi: Math.round(resolutionPpi), bitDepth, profile,
              background: backgroundKind === 'solid'
                ? { kind: 'solid', color: backgroundColor }
                : { kind: 'transparent' }
            });
          }
        }}
      >
        <div className="modal__header">
          <h3 className="modal__title">New document</h3>
        </div>
        <div className="lighttable-new-document-dialog__fields">
          <label className="lighttable-new-document-dialog__wide-field">
            <span>Name</span>
            <FormInput value={name} maxLength={255} onChange={(event) => setName(event.currentTarget.value)} />
          </label>
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
          <label>
            <span>Resolution (ppi)</span>
            <FormInput type="number" min="1" max="2400" value={resolutionPpi}
              onChange={(event) => setResolutionPpi(event.currentTarget.valueAsNumber)} />
          </label>
          <label>
            <span>Bit depth</span>
            <FormSelect value={bitDepth}
              onChange={(event) => setBitDepth(Number(event.currentTarget.value) as 8 | 16)}>
              <option value="8">8 bit</option><option value="16">16 bit</option>
            </FormSelect>
          </label>
          <label>
            <span>Blend compatibility</span>
            <FormSelect value={profile}
              title={documentBlendProfileDescription(profile)}
              onChange={(event) => setProfile(event.currentTarget.value as typeof profile)}>
              <option value="srgb">{documentBlendProfileDisplayName('srgb')}</option>
              <option value="adobe-rgb-1998">{documentBlendProfileDisplayName('adobe-rgb-1998')}</option>
            </FormSelect>
          </label>
          <label>
            <span>Background</span>
            <FormSelect value={backgroundKind}
              onChange={(event) => setBackgroundKind(event.currentTarget.value as typeof backgroundKind)}>
              <option value="transparent">Transparent</option><option value="solid">Solid color</option>
            </FormSelect>
          </label>
          {backgroundKind === 'solid' ? (
            <label className="lighttable-new-document-dialog__wide-field">
              <span>Background color</span>
              <ColorSwatchField value={backgroundColor} ariaLabel="Background color"
                onChange={setBackgroundColor} />
            </label>
          ) : null}
        </div>
        <div className="modal__footer">
          <ActionButton onClick={onCancel}>Cancel</ActionButton>
          <ActionButton type="submit" disabled={!optionsValid || creating}>
            {creating ? 'Creating…' : 'Create'}
          </ActionButton>
        </div>
      </form>
    </div>,
    document.body
  );
}
