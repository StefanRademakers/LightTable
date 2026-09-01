import { AnchorGrid, Button, Checkbox, Dialog, FieldRow, LinkedFields, MaskIcon, NumberField, Select, Text } from '@lighttable/ui';
import { useLayoutEffect, useState } from 'react';

import { lightTableIcon } from '../../../assets/icons';
import type { ImageDocument } from '../document/documentTypes';
import { pixelsToSizeUnit, sizeUnitToPixels, type ImageSizeUnit } from '../../application/imageSize/imageSizeModel';
import {
  MAX_DOCUMENT_GEOMETRY_DIMENSION,
  type CanvasAnchor,
  type DocumentGeometryRequest
} from '../../application/documentGeometry/documentGeometryModel';

export interface CanvasSizeDialogProps {
  readonly open: boolean;
  readonly document: ImageDocument | null;
  readonly busy?: boolean;
  readonly onCancel: () => void;
  readonly onCommit: (request: DocumentGeometryRequest) => void;
}

const SIZE_UNITS: ReadonlyArray<{ value: ImageSizeUnit; label: string }> = [
  { value: 'pixels', label: 'Pixels' }, { value: 'percent', label: 'Percent' },
  { value: 'inches', label: 'Inches' }, { value: 'centimeters', label: 'Centimeters' },
  { value: 'millimeters', label: 'Millimeters' }, { value: 'points', label: 'Points' },
  { value: 'picas', label: 'Picas' }
];

const displayedNumber = (value: number, unit: ImageSizeUnit) =>
  unit === 'pixels' ? String(Math.round(value)) : String(Number(value.toFixed(3)));

export const CanvasSizeDialog = ({ open, document, busy = false, onCancel, onCommit }: CanvasSizeDialogProps) => {
  const [width, setWidth] = useState(1);
  const [height, setHeight] = useState(1);
  const [widthUnit, setWidthUnit] = useState<ImageSizeUnit>('pixels');
  const [heightUnit, setHeightUnit] = useState<ImageSizeUnit>('pixels');
  const [linked, setLinked] = useState(true);
  const [relative, setRelative] = useState(false);
  const [anchorX, setAnchorX] = useState<CanvasAnchor>(0.5);
  const [anchorY, setAnchorY] = useState<CanvasAnchor>(0.5);

  useLayoutEffect(() => {
    if (!open || !document) return;
    setWidth(document.width); setHeight(document.height); setRelative(false);
    setWidthUnit('pixels'); setHeightUnit('pixels'); setLinked(true);
    setAnchorX(0.5); setAnchorY(0.5);
  }, [document, open]);

  if (!open || !document) return null;
  const targetWidth = Math.round(relative ? document.width + width : width);
  const targetHeight = Math.round(relative ? document.height + height : height);
  const valid = targetWidth >= 1 && targetHeight >= 1
    && targetWidth <= MAX_DOCUMENT_GEOMETRY_DIMENSION
    && targetHeight <= MAX_DOCUMENT_GEOMETRY_DIMENSION;
  const setRelativeMode = (next: boolean) => {
    setRelative(next);
    setWidth(next ? 0 : document.width);
    setHeight(next ? 0 : document.height);
  };
  const changeDimension = (axis: 'width' | 'height', raw: number) => {
    if (!Number.isFinite(raw)) return;
    const unit = axis === 'width' ? widthUnit : heightUnit;
    const originalPixels = axis === 'width' ? document.width : document.height;
    const pixels = sizeUnitToPixels(raw, unit, document.resolutionPpi, originalPixels);
    const ratio = document.width / document.height;
    if (axis === 'width') {
      setWidth(pixels);
      if (linked) {
        const linkedHeight = (relative ? document.width + pixels : pixels) / ratio;
        setHeight(relative ? linkedHeight - document.height : linkedHeight);
      }
    } else {
      setHeight(pixels);
      if (linked) {
        const linkedWidth = (relative ? document.height + pixels : pixels) * ratio;
        setWidth(relative ? linkedWidth - document.width : linkedWidth);
      }
    }
  };
  const widthValue = pixelsToSizeUnit(width, widthUnit, document.resolutionPpi, document.width);
  const heightValue = pixelsToSizeUnit(height, heightUnit, document.resolutionPpi, document.height);
  const megapixels = ((targetWidth * targetHeight) / 1_000_000).toFixed(2);

  return <Dialog open={open} as="form" size="regular" title="Canvas Size"
    description={`Canvas Size: ${megapixels} MP`} onDismiss={onCancel} closeOnBackdrop className="canvas-size-dialog"
    onSubmit={(event) => {
      event.preventDefault();
      if (!valid || busy) return;
      onCommit({ operation: 'canvas-size', width: targetWidth, height: targetHeight, anchorX, anchorY });
    }} footer={<>
      <Button tabIndex={0} onClick={onCancel}>Cancel</Button>
      <Button tabIndex={0} type="submit" disabled={!valid || busy}>{busy ? 'Applying…' : 'OK'}</Button>
    </>}>
    <LinkedFields firstLabel={relative ? 'Width change' : 'Width'} secondLabel={relative ? 'Height change' : 'Height'}
      linked={linked} tabIndex={0} onLinkedChange={setLinked}
      linkLabel={linked ? 'Unlink width and height' : 'Link width and height'}
      linkIcon={<MaskIcon src={lightTableIcon('link_vertical.png')} mode="luminance" />}
      firstField={<span className="canvas-size-dialog__field-pair">
        <NumberField tabIndex={0} value={widthValue} kind={widthUnit === 'pixels' ? 'integer' : 'float'} step={1}
          formatValue={(value) => displayedNumber(value, widthUnit)} onValueChange={(value) => changeDimension('width', value)} />
        <Select tabIndex={0} aria-label="Width unit" value={widthUnit}
          onValueChange={(value) => setWidthUnit(value as ImageSizeUnit)} options={SIZE_UNITS} />
      </span>}
      secondField={<span className="canvas-size-dialog__field-pair">
        <NumberField tabIndex={0} value={heightValue} kind={heightUnit === 'pixels' ? 'integer' : 'float'} step={1}
          formatValue={(value) => displayedNumber(value, heightUnit)} onValueChange={(value) => changeDimension('height', value)} />
        <Select tabIndex={0} aria-label="Height unit" value={heightUnit}
          onValueChange={(value) => setHeightUnit(value as ImageSizeUnit)} options={SIZE_UNITS} />
      </span>} />
    <label className="canvas-size-dialog__relative">
      <Checkbox tabIndex={0} checked={relative} onChange={(event) => setRelativeMode(event.currentTarget.checked)} />
      <Text>Relative</Text>
    </label>
    <FieldRow label="Anchor">
      <AnchorGrid tabIndex={0} x={anchorX} y={anchorY}
        onChange={(x, y) => { setAnchorX(x); setAnchorY(y); }} />
    </FieldRow>
    {!valid ? <Text className="lighttable-preferences__error">Resulting dimensions must be 1–{MAX_DOCUMENT_GEOMETRY_DIMENSION} pixels.</Text> : null}
  </Dialog>;
};
