import { Button, TextInput, NumberField } from '@lighttable/ui';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LightTableImageClipboard } from '../platform/LightTableImageClipboard';


import { Select } from '@lighttable/ui';
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
  readonly presentation?: 'dialog' | 'embedded';
}

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const MAX_DIMENSION = 32768;
const MAX_PIXEL_COUNT = 268_435_456;

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
  onCreate,
  presentation = 'dialog'
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
  const modal = presentation === 'dialog';
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLFormElement>(open && modal, onCancel);

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
    && normalizedHeight <= MAX_DIMENSION
    && normalizedWidth * normalizedHeight <= MAX_PIXEL_COUNT;
  const optionsValid = valid && name.trim().length > 0 && name.trim().length <= 255
    && Number.isFinite(resolutionPpi) && resolutionPpi >= 1 && resolutionPpi <= 2400;

  const form = (
      <form
        ref={dialogRef}
        className={`${modal ? 'modal ' : ''}lighttable-new-document-dialog${modal ? '' : ' lighttable-new-document-dialog--embedded'}`}
        role={modal ? 'dialog' : undefined}
        aria-modal={modal ? 'true' : undefined}
        aria-label="New document"
        tabIndex={modal ? -1 : undefined}
        data-editor-native-tab-navigation={modal ? true : undefined}
        onKeyDown={modal ? onDialogKeyDown : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          if (optionsValid && !creating) {
            onCreate({
              name: name.trim(), width: normalizedWidth, height: normalizedHeight,
              resolutionPpi, bitDepth, profile,
              background: backgroundKind === 'solid'
                ? { kind: 'solid', color: backgroundColor }
                : { kind: 'transparent' }
            });
          }
        }}
      >
        {modal ? <div className="modal__header">
          <h3 className="modal__title">New document</h3>
        </div> : null}
        <div className="lighttable-new-document-dialog__fields">
          <label className="lighttable-new-document-dialog__wide-field">
            <span>Name</span>
            <TextInput tabIndex={modal ? 0 : -1} value={name} maxLength={255} onChange={(event) => setName(event.currentTarget.value)} />
          </label>
          <label>
            <span>Width</span>
            <NumberField tabIndex={modal ? 0 : -1} updateMode="input" kind="integer"
              autoFocus={modal}
              inputMode="numeric"
              min="1"
              max={MAX_DIMENSION}
              value={width}
              onValueChange={setWidth} onEmpty={() => setWidth(NaN)}
            />
          </label>
          <label>
            <span>Height</span>
            <NumberField tabIndex={modal ? 0 : -1} updateMode="input" kind="integer"
              inputMode="numeric"
              min="1"
              max={MAX_DIMENSION}
              value={height}
              onValueChange={setHeight} onEmpty={() => setHeight(NaN)}
            />
          </label>
          <label>
            <span>Resolution (ppi)</span>
            <NumberField tabIndex={modal ? 0 : -1} updateMode="input" min="1" max="2400" value={resolutionPpi}
              onValueChange={setResolutionPpi} onEmpty={() => setResolutionPpi(NaN)} />
          </label>
          <label>
            <span>Bit depth</span>
            <Select tabIndex={modal ? 0 : -1} value={bitDepth}
              onValueChange={(nextValue) => setBitDepth(Number(nextValue) as 8 | 16)}>
              <option value="8">8 bit</option><option value="16">16 bit</option>
            </Select>
          </label>
          <label>
            <span>Blend compatibility</span>
            <Select tabIndex={modal ? 0 : -1} value={profile}
              title={documentBlendProfileDescription(profile)}
              onValueChange={(nextValue) => setProfile(nextValue as typeof profile)}>
              <option value="srgb">{documentBlendProfileDisplayName('srgb')}</option>
              <option value="adobe-rgb-1998">{documentBlendProfileDisplayName('adobe-rgb-1998')}</option>
            </Select>
          </label>
          <label>
            <span>Background</span>
            <Select tabIndex={modal ? 0 : -1} value={backgroundKind}
              onValueChange={(nextValue) => setBackgroundKind(nextValue as typeof backgroundKind)}>
              <option value="transparent">Transparent</option><option value="solid">Solid color</option>
            </Select>
          </label>
          {backgroundKind === 'solid' ? (
            <label className="lighttable-new-document-dialog__wide-field">
              <span>Background color</span>
              <ColorSwatchField tabIndex={modal ? 0 : -1} value={backgroundColor} ariaLabel="Background color"
                onChange={setBackgroundColor} />
            </label>
          ) : null}
        </div>
        <div className="modal__footer">
          {modal ? <Button tabIndex={modal ? 0 : -1} onClick={onCancel}>Cancel</Button> : null}
          <Button tabIndex={modal ? 0 : -1} type="submit" disabled={!optionsValid || creating}>
            {creating ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
  );
  return modal ? createPortal(
    <div className="modal-backdrop lighttable-dialog-backdrop">{form}</div>,
    document.body
  ) : form;
}
