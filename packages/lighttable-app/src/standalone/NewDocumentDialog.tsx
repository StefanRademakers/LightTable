import { Button, Dialog, TextInput, NumberField } from '@lighttable/ui';
import { useEffect, useRef, useState } from 'react';
import type {
  LightTableClipboardImageDimensions,
  LightTableImageClipboard
} from '../platform/LightTableImageClipboard';


import { Select } from '@lighttable/ui';
import { ColorSwatchField } from '../ui/ColorSwatchField';
import type { LightTableCreateDocumentOptions } from '../lighttable/application/commands/lightTableCommandService';
import {
  documentBlendProfileDescription,
  documentBlendProfileDisplayName
} from '../lighttable/editor/color/documentColorTransform';

interface NewDocumentDialogProps {
  readonly open: boolean;
  readonly clipboard?: LightTableImageClipboard;
  readonly initialDimensions?: LightTableClipboardImageDimensions | null;
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
  if (clipboard.readDimensions) return clipboard.readDimensions();
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
  initialDimensions,
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

  useEffect(() => {
    if (!open) return;
    const request = ++requestRef.current;
    setWidth(initialDimensions?.width ?? DEFAULT_WIDTH);
    setHeight(initialDimensions?.height ?? DEFAULT_HEIGHT);
    setName('Untitled');
    setResolutionPpi(72);
    setBitDepth(8);
    setProfile('srgb');
    setBackgroundKind('transparent');
    setBackgroundColor('#ffffff');
    if (initialDimensions) return () => {
      requestRef.current += 1;
    };
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
  }, [clipboard, initialDimensions, open]);

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

  const submit = () => {
    if (optionsValid && !creating) {
      onCreate({
        name: name.trim(), width: normalizedWidth, height: normalizedHeight,
        resolutionPpi, bitDepth, profile,
        background: backgroundKind === 'solid'
          ? { kind: 'solid', color: backgroundColor }
          : { kind: 'transparent' }
      });
    }
  };
  const content = (
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
  );
  if (modal) return (
    <Dialog open={open} as="form" size="wide" title="New document"
      onDismiss={creating ? () => undefined : onCancel}
      onSubmit={(event) => { event.preventDefault(); submit(); }}
      footer={<>
        <Button tabIndex={0} onClick={onCancel} disabled={creating}>Cancel</Button>
        <Button tabIndex={0} type="submit" disabled={!optionsValid || creating}>
          {creating ? 'Creating…' : 'Create'}
        </Button>
      </>}>
      {content}
    </Dialog>
  );
  return (
    <form className="lighttable-new-document-dialog lighttable-new-document-dialog--embedded"
      aria-label="New document" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      {content}
      <div className="modal__footer">
          <Button tabIndex={modal ? 0 : -1} type="submit" disabled={!optionsValid || creating}>
            {creating ? 'Creating…' : 'Create'}
          </Button>
      </div>
    </form>
  );
}
