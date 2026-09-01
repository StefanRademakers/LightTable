import { Checkbox, Button, Dialog, FieldRow, LinkedFields, MaskIcon, NumberField, Select, Text } from '@lighttable/ui';
import { useLayoutEffect, useMemo, useState } from 'react';
import { AdjustmentSlider } from '../../../ui/AdjustmentSlider';
import { lightTableIcon } from '../../../assets/icons';
import type { ImageDocument } from '../document/documentTypes';
import {
  MAX_IMAGE_SIZE_DIMENSION,
  captureOriginalImageSize,
  estimateDocumentImageBytes,
  pixelsToSizeUnit,
  resolutionFromPpi,
  resolutionToPpi,
  sizeUnitToPixels,
  type ImageSizeRequest,
  type ImageSizeUnit,
  type ResampleMethod,
  type ResolutionUnit
} from '../../application/imageSize/imageSizeModel';

export interface ImageSizeDialogProps {
  readonly open: boolean;
  readonly document: ImageDocument | null;
  readonly busy?: boolean;
  readonly onCancel: () => void;
  readonly onCommit: (request: ImageSizeRequest) => void;
}

const SIZE_UNITS: ReadonlyArray<{ value: ImageSizeUnit; label: string }> = [
  { value: 'pixels', label: 'Pixels' }, { value: 'percent', label: 'Percent' },
  { value: 'inches', label: 'Inches' }, { value: 'centimeters', label: 'Centimeters' },
  { value: 'millimeters', label: 'Millimeters' }, { value: 'points', label: 'Points' },
  { value: 'picas', label: 'Picas' }
];

const RESAMPLE_METHODS: ReadonlyArray<{ value: ResampleMethod; label: string }> = [
  { value: 'automatic', label: 'Automatic' },
  { value: 'preserve-details-2', label: 'Preserve Details 2.0' },
  { value: 'preserve-details', label: 'Preserve Details (enlargement)' },
  { value: 'bicubic-smoother', label: 'Bicubic Smoother (enlargement)' },
  { value: 'bicubic-sharper', label: 'Bicubic Sharper (reduction)' },
  { value: 'bicubic', label: 'Bicubic (smooth gradients)' },
  { value: 'nearest', label: 'Nearest Neighbor (hard edges)' },
  { value: 'bilinear', label: 'Bilinear' }
];

const formattedSize = (bytes: number) => {
  const mib = bytes / (1024 * 1024);
  return mib < 0.1 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${mib.toFixed(1)} MB`;
};

const displayedNumber = (value: number, unit: ImageSizeUnit) =>
  unit === 'pixels' ? String(Math.round(value)) : String(Number(value.toFixed(3)));

export const ImageSizeDialog = ({
  open, document, busy = false, onCancel, onCommit
}: ImageSizeDialogProps) => {
  const original = useMemo(() => document ? captureOriginalImageSize(document) : null, [document, open]);
  const [widthPx, setWidthPx] = useState(1);
  const [heightPx, setHeightPx] = useState(1);
  const [widthUnit, setWidthUnit] = useState<ImageSizeUnit>('pixels');
  const [heightUnit, setHeightUnit] = useState<ImageSizeUnit>('pixels');
  const [resolutionPpi, setResolutionPpi] = useState(72);
  const [resolutionUnit, setResolutionUnit] = useState<ResolutionUnit>('pixels-per-inch');
  const [linked, setLinked] = useState(true);
  const [resample, setResample] = useState(true);
  const [method, setMethod] = useState<ResampleMethod>('automatic');
  const [noiseReduction, setNoiseReduction] = useState(0);

  useLayoutEffect(() => {
    if (!open || !original) return;
    setWidthPx(original.widthPx); setHeightPx(original.heightPx);
    setResolutionPpi(original.resolutionPpi);
    setWidthUnit('pixels'); setHeightUnit('pixels'); setResolutionUnit('pixels-per-inch');
    setLinked(true); setResample(true); setMethod('automatic'); setNoiseReduction(0);
  }, [open, original]);

  if (!open || !document || !original) return null;
  const resultWidth = resample ? Math.max(1, Math.round(widthPx)) : original.widthPx;
  const resultHeight = resample ? Math.max(1, Math.round(heightPx)) : original.heightPx;
  const valid = resultWidth <= MAX_IMAGE_SIZE_DIMENSION && resultHeight <= MAX_IMAGE_SIZE_DIMENSION
    && Number.isFinite(resolutionPpi) && resolutionPpi >= 1 && resolutionPpi <= 2400;
  const widthValue = pixelsToSizeUnit(resultWidth, widthUnit, resolutionPpi, original.widthPx);
  const heightValue = pixelsToSizeUnit(resultHeight, heightUnit, resolutionPpi, original.heightPx);
  const changeDimension = (axis: 'width' | 'height', raw: number) => {
    if (!resample || !Number.isFinite(raw) || raw <= 0) return;
    const unit = axis === 'width' ? widthUnit : heightUnit;
    const originalPixels = axis === 'width' ? original.widthPx : original.heightPx;
    const pixels = Math.max(1, sizeUnitToPixels(raw, unit, resolutionPpi, originalPixels));
    if (axis === 'width') {
      setWidthPx(pixels);
      if (linked) setHeightPx(Math.max(1, Math.round(pixels / original.aspectRatio)));
    } else {
      setHeightPx(pixels);
      if (linked) setWidthPx(Math.max(1, Math.round(pixels * original.aspectRatio)));
    }
  };

  const submit = () => onCommit({
    width: resultWidth, height: resultHeight, resolutionPpi,
    resample, method, preserveDetailsNoiseReduction: noiseReduction, scaleStyles: true
  });
  const megapixels = ((resultWidth * resultHeight) / 1_000_000).toFixed(2);

  return <Dialog open={open} as="form" size="regular" title="Image Size"
    description={`Image Size: ${megapixels} MP · ${formattedSize(estimateDocumentImageBytes(resultWidth, resultHeight, document.colorSettings.bitDepth))}`}
    onDismiss={onCancel} closeOnBackdrop className="image-size-dialog"
    onSubmit={(event) => {
      event.preventDefault();
      if (valid && !busy) submit();
    }}
    footer={<>
      <Button tabIndex={0} type="button" onClick={onCancel}>Cancel</Button>
      <Button tabIndex={0} type="submit" disabled={!valid || busy}>{busy ? 'Resizing…' : 'OK'}</Button>
    </>}>
    <LinkedFields firstLabel="Width" secondLabel="Height" linked={linked} tabIndex={0}
      linkLabel={linked ? 'Unlink width and height' : 'Link width and height'}
      linkIcon={<MaskIcon src={lightTableIcon('link_vertical.png')} mode="luminance" />}
      onLinkedChange={setLinked}
      firstField={<span className="image-size-dialog__field-pair">
        <NumberField tabIndex={0} min={0.001} step={1} disabled={!resample}
          kind={widthUnit === 'pixels' ? 'integer' : 'float'} value={widthValue}
          formatValue={(value) => displayedNumber(value, widthUnit)}
          onValueChange={(value) => changeDimension('width', value)} />
        <Select tabIndex={0} aria-label="Width unit" value={widthUnit}
          onValueChange={(nextValue) => setWidthUnit(nextValue as ImageSizeUnit)}>
          {SIZE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
        </Select>
      </span>}
      secondField={<span className="image-size-dialog__field-pair">
        <NumberField tabIndex={0} min={0.001} step={1} disabled={!resample}
          kind={heightUnit === 'pixels' ? 'integer' : 'float'} value={heightValue}
          formatValue={(value) => displayedNumber(value, heightUnit)}
          onValueChange={(value) => changeDimension('height', value)} />
        <Select tabIndex={0} aria-label="Height unit" value={heightUnit}
          onValueChange={(nextValue) => setHeightUnit(nextValue as ImageSizeUnit)}>
          {SIZE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
        </Select>
      </span>}
    />
    <FieldRow label="Resolution">
      <span className="image-size-dialog__field-pair">
        <NumberField tabIndex={0} min={resolutionFromPpi(1, resolutionUnit)} max={resolutionFromPpi(2400, resolutionUnit)} step={1}
          value={resolutionFromPpi(resolutionPpi, resolutionUnit)}
          formatValue={(value) => String(Number(value.toFixed(3)))}
          onValueChange={(value) => {
            const next = resolutionToPpi(value, resolutionUnit);
            if (Number.isFinite(next)) setResolutionPpi(next);
          }} />
        <Select tabIndex={0} aria-label="Resolution unit" value={resolutionUnit}
          onValueChange={(nextValue) => setResolutionUnit(nextValue as ResolutionUnit)}>
          <option value="pixels-per-inch">Pixels/Inch</option>
          <option value="pixels-per-centimeter">Pixels/Centimeter</option>
        </Select>
      </span>
    </FieldRow>
    <label className="image-size-dialog__option">
      <Checkbox tabIndex={0} checked={resample} onChange={(event) => setResample(event.currentTarget.checked)} />
      <Text>Resample</Text>
      <Select tabIndex={0} aria-label="Resampling method" value={method} disabled={!resample}
        onValueChange={(nextValue) => setMethod(nextValue as ResampleMethod)}>
        {RESAMPLE_METHODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </Select>
    </label>
    {method === 'preserve-details-2' && resample ? <AdjustmentSlider label="Reduce Noise"
      value={noiseReduction} min={0} max={100} layout="inline" format={(value) => `${Math.round(value)}%`}
      onChange={setNoiseReduction} onReset={() => setNoiseReduction(0)} /> : null}
  </Dialog>;
};
