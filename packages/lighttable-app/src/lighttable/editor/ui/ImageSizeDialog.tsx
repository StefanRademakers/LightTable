import { useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from '../../../ui/ActionButton';
import { NumericExpressionInput } from '../../../ui/NumericExpressionInput';
import { SwitchControl } from '../../../ui/SwitchControl';
import { useDialogAccessibility } from '../../../ui/useDialogAccessibility';
import { AdjustmentSlider } from '../../AdjustmentSlider';
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
  const [scaleStyles, setScaleStyles] = useState(true);
  const [preset, setPreset] = useState<'original' | 'custom'>('original');
  const { dialogRef, onDialogKeyDown } = useDialogAccessibility<HTMLFormElement>(open, onCancel);

  useLayoutEffect(() => {
    if (!open || !original) return;
    setWidthPx(original.widthPx); setHeightPx(original.heightPx);
    setResolutionPpi(original.resolutionPpi);
    setWidthUnit('pixels'); setHeightUnit('pixels'); setResolutionUnit('pixels-per-inch');
    setLinked(true); setResample(true); setMethod('automatic'); setNoiseReduction(0);
    setScaleStyles(true); setPreset('original');
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
    setPreset('custom');
  };
  const restoreOriginal = () => {
    setWidthPx(original.widthPx); setHeightPx(original.heightPx);
    setResolutionPpi(original.resolutionPpi); setPreset('original');
  };

  return createPortal(
    <div className="modal-backdrop lighttable-dialog-backdrop" onMouseDown={onCancel}>
      <form
        ref={dialogRef}
        className="modal image-size-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Image Size"
        tabIndex={-1}
        data-editor-native-tab-navigation
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onDialogKeyDown}
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || busy) return;
          onCommit({
            width: resultWidth, height: resultHeight, resolutionPpi,
            resample, method, preserveDetailsNoiseReduction: noiseReduction, scaleStyles
          });
        }}
      >
        <div className="modal__header"><h3 className="modal__title">Image Size</h3></div>
        <div className="image-size-dialog__summary">
          <div><span>Image Size</span><strong>{formattedSize(estimateDocumentImageBytes(resultWidth, resultHeight, document.colorSettings.bitDepth))}</strong></div>
          <div><span>Dimensions</span><strong>{resultWidth} px × {resultHeight} px</strong></div>
        </div>
        <div className="image-size-dialog__body">
          <label className="image-size-dialog__row">
            <span>Fit To</span>
            <select className="form-input" value={preset} onChange={(event) => {
              if (event.currentTarget.value === 'original') restoreOriginal();
              else setPreset('custom');
            }}><option value="original">Original Size</option><option value="custom">Custom</option></select>
          </label>
          <div className="image-size-dialog__dimensions">
            <label><span>Width</span><NumericExpressionInput min={0.001} step={1} disabled={!resample}
              kind={widthUnit === 'pixels' ? 'integer' : 'float'} value={widthValue}
              formatValue={(value) => displayedNumber(value, widthUnit)}
              onValueChange={(value) => changeDimension('width', value)} /></label>
            <select aria-label="Width unit" className="form-input" value={widthUnit}
              onChange={(event) => setWidthUnit(event.currentTarget.value as ImageSizeUnit)}>
              {SIZE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
            </select>
            <label><span>Height</span><NumericExpressionInput min={0.001} step={1} disabled={!resample}
              kind={heightUnit === 'pixels' ? 'integer' : 'float'} value={heightValue}
              formatValue={(value) => displayedNumber(value, heightUnit)}
              onValueChange={(value) => changeDimension('height', value)} /></label>
            <select aria-label="Height unit" className="form-input" value={heightUnit}
              onChange={(event) => setHeightUnit(event.currentTarget.value as ImageSizeUnit)}>
              {SIZE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
            </select>
          </div>
          <div className="image-size-dialog__link-row">
            <span>Constrain proportions</span>
            <SwitchControl checked={linked} onCheckedChange={setLinked} label="Constrain proportions" />
          </div>
          <label className="image-size-dialog__row">
            <span>Resolution</span>
            <NumericExpressionInput min={resolutionFromPpi(1, resolutionUnit)} max={resolutionFromPpi(2400, resolutionUnit)} step={1}
              value={resolutionFromPpi(resolutionPpi, resolutionUnit)}
              formatValue={(value) => String(Number(value.toFixed(3)))}
              onValueChange={(value) => {
                const next = resolutionToPpi(value, resolutionUnit);
                if (Number.isFinite(next)) { setResolutionPpi(next); setPreset('custom'); }
              }} />
            <select className="form-input" value={resolutionUnit}
              onChange={(event) => setResolutionUnit(event.currentTarget.value as ResolutionUnit)}>
              <option value="pixels-per-inch">Pixels/Inch</option>
              <option value="pixels-per-centimeter">Pixels/Centimeter</option>
            </select>
          </label>
          <div className="image-size-dialog__row image-size-dialog__resample-row">
            <span>Resample</span>
            <SwitchControl checked={resample} onCheckedChange={setResample} label="Resample image pixels" />
            <select aria-label="Resampling method" className="form-input" value={method} disabled={!resample}
              onChange={(event) => setMethod(event.currentTarget.value as ResampleMethod)}>
              {RESAMPLE_METHODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          {method === 'preserve-details-2' && resample ? (
            <div className="image-size-dialog__noise">
              <AdjustmentSlider label="Reduce Noise" value={noiseReduction} min={0} max={100}
                layout="inline" format={(value) => `${Math.round(value)}%`}
                onChange={setNoiseReduction} onReset={() => setNoiseReduction(0)} />
            </div>
          ) : null}
          <label className="image-size-dialog__check"><input type="checkbox" checked={scaleStyles}
            onChange={(event) => setScaleStyles(event.currentTarget.checked)} /> Scale Styles</label>
        </div>
        <div className="modal__footer">
          <ActionButton onClick={onCancel}>Cancel</ActionButton>
          <ActionButton type="submit" disabled={!valid || busy}>{busy ? 'Resizing…' : 'OK'}</ActionButton>
        </div>
      </form>
    </div>,
    globalThis.document.body
  );
};
