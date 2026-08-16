import { ButtonBase } from '../../../ui/ButtonBase';
import React from 'react';
import { createDefaultGradientPaint, type GradientPaintInstance } from '@lighttable/paint-core';
import type { VectorPaint } from '@lighttable/vector-core';
import type { ToolId, VectorToolStyleSettings } from '../session/editorSession';
import { AnchoredGradientPopover } from './AnchoredGradientPopover';
import { GradientAssetEditor } from './LayerStyleGradientEditor';
import { ToolOptionNumber, ToolOptionSelect } from './ToolOptionControls';
import { ColorPicker, colorPickerHex, colorPickerParseHex } from '../../../ui/ColorPicker';
import { ColorSwatchField } from '../../../ui/ColorSwatchField';
import { GradientField } from '../../../ui/GradientField';
import { NonePaintField } from '../../../ui/NonePaintField';
import { SegmentedControl } from '../../../ui/SegmentedControl';

type PaintType = 'none' | 'color' | 'gradient';

const GradientOptions: React.FC<{
  paint: GradientPaintInstance;
  prefix: string;
  onChange: (paint: GradientPaintInstance) => void;
}> = ({ paint, prefix, onChange }) => {
  const gradientLabel = prefix ? `${prefix}gradient` : 'Gradient';
  const reverseLabel = prefix ? `Reverse ${prefix.toLocaleLowerCase()}gradient` : 'Reverse gradient';
  return <div className="lighttable-tool-options__gradient-options">
    <ToolOptionSelect label="Style" value={paint.shape}
      aria-label={`${gradientLabel} style`}
      onChange={(event) => onChange({
        ...paint, shape: event.currentTarget.value as GradientPaintInstance['shape']
      })}>
      <option value="linear">Linear</option><option value="radial">Radial</option>
      <option value="angle">Angle</option><option value="reflected">Reflected</option>
      <option value="diamond">Diamond</option>
    </ToolOptionSelect>
    <label className="lighttable-tool-options__toggle">
      <input type="checkbox" checked={paint.reverse}
        aria-label={reverseLabel}
        onChange={(event) => onChange({ ...paint, reverse: event.currentTarget.checked })} />
      <span>Reverse</span>
    </label>
  </div>;
};

const VectorPaintOption: React.FC<{
  label: 'Fill' | 'Line';
  enabled: boolean;
  color: string;
  paint?: VectorPaint | null;
  opacity?: number;
  onEnabledChange: (enabled: boolean) => void;
  onColorChange: (color: string) => void;
  onPaintChange: (paint: VectorPaint | null) => void;
  onOpacityChange?: (opacity: number) => void;
}> = ({
  label, enabled, color, paint, opacity,
  onEnabledChange, onColorChange, onPaintChange, onOpacityChange
}) => {
  const externalGradient = paint && 'kind' in paint ? paint as GradientPaintInstance : null;
  const externalType: PaintType = !enabled ? 'none' : externalGradient ? 'gradient' : 'color';
  const [type, setPresentedType] = React.useState<PaintType>(externalType);
  const [gradient, setPresentedGradient] = React.useState<GradientPaintInstance | null>(externalGradient);
  const [presentedColor, setPresentedColor] = React.useState(color);
  const [open, setOpen] = React.useState(false);
  const anchor = React.useRef<HTMLSpanElement>(null);
  const toggle = () => setOpen((current) => !current);
  React.useEffect(() => {
    setPresentedType(externalType);
    setPresentedGradient(externalGradient);
  }, [enabled, externalGradient, externalType]);
  React.useEffect(() => setPresentedColor(color), [color]);
  const setType = (next: PaintType) => {
    setPresentedType(next);
    if (next === 'none') {
      onEnabledChange(false);
      return;
    }
    if (next === 'color') onPaintChange(null);
    else if (!gradient) {
      const nextGradient = createDefaultGradientPaint(
        `vector-${label.toLowerCase()}-gradient`, 'object-bounds'
      );
      setPresentedGradient(nextGradient);
      onPaintChange(nextGradient);
    }
  };
  const changeColor = (next: string) => {
    setPresentedColor(next);
    onColorChange(next);
  };
  const changeGradient = (next: GradientPaintInstance) => {
    setPresentedGradient(next);
    onPaintChange(next);
  };

  return <div className="lighttable-tool-options__color-field">
    <span>{label}</span>
    <span ref={anchor} className="lighttable-tool-options__paint-trigger">
      {type === 'none' ? <NonePaintField size="compact" ariaLabel={`${label} paint`}
        expanded={open} onClick={toggle} /> : type === 'gradient' ? <GradientField
          size="compact" value={gradient!.asset} ariaLabel={`${label} paint`}
          expanded={open} onClick={toggle} /> : <ColorSwatchField
            size="compact" accessory="chevron" value={presentedColor} ariaLabel={`${label} paint`}
            expanded={open} onActivate={toggle} onChange={changeColor} />}
    </span>
    {open ? <AnchoredGradientPopover anchor={anchor} ariaLabel={`${label} paint options`}
      onClose={() => setOpen(false)}>
      <div className="lighttable-tool-options__gradient-header">
        <strong>{label} paint</strong>
        <ButtonBase type="button" aria-label={`Close ${label.toLowerCase()} paint`}
          onClick={() => setOpen(false)}>×</ButtonBase>
      </div>
      <SegmentedControl className="lighttable-tool-options__paint-types"
        ariaLabel={`${label} paint type`} value={type} onChange={setType}
        options={[
          { value: 'none', label: 'None' },
          { value: 'color', label: 'Color' },
          { value: 'gradient', label: 'Gradient' }
        ]} />
      {type === 'color' ? <ColorPicker
        value={colorPickerParseHex(presentedColor) ?? { r: 0, g: 0, b: 0, a: 1 }}
        opacity={opacity} onOpacityChange={onOpacityChange}
        onChange={(next) => changeColor(colorPickerHex(next).toLowerCase())} /> : null}
      {type === 'gradient' && gradient ? <>
        <GradientAssetEditor value={gradient.asset}
          onChange={(asset) => changeGradient({ ...gradient, asset })} />
        <GradientOptions paint={gradient} prefix={label === 'Line' ? 'Stroke ' : ''}
          onChange={changeGradient} />
      </> : null}
    </AnchoredGradientPopover> : null}
  </div>;
};

const VectorLineStyleOption: React.FC<{
  style: VectorToolStyleSettings;
  onChange: (change: Partial<VectorToolStyleSettings>) => void;
}> = ({ style, onChange }) => {
  const [open, setOpen] = React.useState(false);
  const anchor = React.useRef<HTMLButtonElement>(null);
  return <>
    <ButtonBase ref={anchor} type="button" className="lighttable-tool-options__dropdown-trigger"
      aria-label="Line Style" aria-haspopup="dialog" aria-expanded={open}
      disabled={!style.strokeEnabled} onClick={() => setOpen((current) => !current)}>
      <span>Line Style</span><span className="paint-field__arrow" aria-hidden="true" />
    </ButtonBase>
    {open ? <AnchoredGradientPopover anchor={anchor} ariaLabel="Line style options"
      className="lighttable-tool-options__line-style-popover" onClose={() => setOpen(false)}>
      <div className="lighttable-tool-options__gradient-header">
        <strong>Line Style</strong>
        <ButtonBase type="button" aria-label="Close line style" onClick={() => setOpen(false)}>×</ButtonBase>
      </div>
      <div className="lighttable-tool-options__line-style-options">
        <ToolOptionSelect label="Style" value={style.strokeStyle ?? 'solid'}
          aria-label="Stroke style"
          onChange={(event) => onChange({
            strokeStyle: event.currentTarget.value as NonNullable<VectorToolStyleSettings['strokeStyle']>
          })}>
          <option value="solid">Solid</option><option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </ToolOptionSelect>
        <ToolOptionSelect label="Align" value={style.strokeAlignment}
          aria-label="Stroke alignment"
          onChange={(event) => onChange({
            strokeAlignment: event.currentTarget.value as VectorToolStyleSettings['strokeAlignment']
          })}>
          <option value="inside">Inside</option><option value="center">Center</option>
          <option value="outside">Outside</option>
        </ToolOptionSelect>
        <ToolOptionSelect label="Cap" value={style.strokeCap ?? 'round'}
          aria-label="Stroke cap"
          onChange={(event) => onChange({
            strokeCap: event.currentTarget.value as VectorToolStyleSettings['strokeCap']
          })}>
          <option value="butt">Butt</option><option value="round">Round</option>
          <option value="square">Square</option>
        </ToolOptionSelect>
        <ToolOptionSelect label="Join" value={style.strokeJoin ?? 'round'}
          aria-label="Stroke join"
          onChange={(event) => onChange({
            strokeJoin: event.currentTarget.value as VectorToolStyleSettings['strokeJoin']
          })}>
          <option value="miter">Miter</option><option value="round">Round</option>
          <option value="bevel">Bevel</option>
        </ToolOptionSelect>
        {(style.strokeJoin ?? 'round') === 'miter' ? <ToolOptionNumber
          label="Miter" min={1} max={100} step={0.5} value={style.strokeMiterLimit ?? 4}
          onChange={(value) => onChange({ strokeMiterLimit: Math.max(1, value || 1) })} /> : null}
      </div>
    </AnchoredGradientPopover> : null}
  </>;
};

export const VectorStyleToolOptions: React.FC<{
  activeTool: ToolId;
  style: VectorToolStyleSettings;
  onChange: (change: Partial<VectorToolStyleSettings>) => void;
}> = ({ activeTool, style, onChange }) => (
  <div className="lighttable-tool-options__vector-style" aria-label="Vector style">
    {activeTool !== 'shape-line' ? <VectorPaintOption label="Fill"
      enabled={style.fillEnabled} color={style.fillColor} paint={style.fillPaint}
      onEnabledChange={(fillEnabled) => onChange({ fillEnabled })}
      onColorChange={(fillColor) => onChange({ fillEnabled: true, fillColor, fillPaint: null })}
      onPaintChange={(fillPaint) => onChange({ fillEnabled: true, fillPaint })} /> : null}
    <VectorPaintOption label="Line"
      enabled={style.strokeEnabled} color={style.strokeColor} paint={style.strokePaint}
      opacity={style.strokeOpacity ?? 1}
      onEnabledChange={(strokeEnabled) => onChange({ strokeEnabled })}
      onColorChange={(strokeColor) => onChange({ strokeEnabled: true, strokeColor, strokePaint: null })}
      onPaintChange={(strokePaint) => onChange({ strokeEnabled: true, strokePaint })}
      onOpacityChange={(strokeOpacity) => onChange({ strokeOpacity })} />
    <ToolOptionNumber label="Weight" min={0.1} max={1000} step={0.5}
      value={style.strokeWidth} unit="px" disabled={!style.strokeEnabled}
      onChange={(value) => onChange({ strokeWidth: Math.max(0.1, value || 0.1) })} />
    <VectorLineStyleOption style={style} onChange={onChange} />
  </div>
);
