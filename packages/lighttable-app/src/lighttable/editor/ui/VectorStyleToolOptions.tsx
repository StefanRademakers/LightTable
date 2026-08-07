import React from 'react';
import { createDefaultGradientPaint, type GradientPaintInstance } from '@lighttable/paint-core';
import type { ToolId, VectorToolStyleSettings } from '../session/editorSession';
import { AnchoredGradientPopover } from './AnchoredGradientPopover';
import { GradientAssetEditor } from './LayerStyleGradientEditor';
import { ToolOptionColor, ToolOptionNumber, ToolOptionSelect } from './ToolOptionControls';
import { GradientField } from '../../../ui/GradientField';

export const VectorStyleToolOptions: React.FC<{
  activeTool: ToolId;
  style: VectorToolStyleSettings;
  onChange: (change: Partial<VectorToolStyleSettings>) => void;
}> = ({ activeTool, style, onChange }) => {
  const fillGradient = style.fillPaint && 'kind' in style.fillPaint
    ? style.fillPaint as GradientPaintInstance : null;
  const strokeGradient = style.strokePaint && 'kind' in style.strokePaint
    ? style.strokePaint as GradientPaintInstance : null;
  const [fillOpen, setFillOpen] = React.useState(false);
  const [strokeOpen, setStrokeOpen] = React.useState(false);
  const fillAnchor = React.useRef<HTMLButtonElement>(null);
  const strokeAnchor = React.useRef<HTMLButtonElement>(null);

  return <div className="lighttable-tool-options__vector-style" aria-label="Vector style">
    {activeTool !== 'shape-line' ? <>
      <ToolOptionColor label="Fill" value={style.fillColor} enabled={style.fillEnabled}
        allowChangeWhenOff
        onEnabledChange={(fillEnabled) => onChange({
          fillEnabled, ...(fillEnabled ? { fillColor: style.fillColor } : {})
        })}
        onChange={(fillColor) => onChange({ fillEnabled: true, fillColor, fillPaint: null })}
        status={<GradientField ref={fillAnchor}
          value={(fillGradient ?? createDefaultGradientPaint(
            'vector-fill-gradient-preview', 'object-bounds'
          )).asset}
          ariaLabel="Edit fill gradient" title="Edit fill gradient" expanded={fillOpen}
          onClick={() => {
            if (!fillGradient) onChange({
              fillEnabled: true,
              fillPaint: createDefaultGradientPaint('vector-fill-gradient', 'object-bounds')
            });
            setFillOpen((open) => !open);
          }} />} />
      {fillGradient && fillOpen ? <AnchoredGradientPopover anchor={fillAnchor} ariaLabel="Fill gradient">
        <div className="lighttable-tool-options__gradient-header">
          <strong>Fill gradient</strong>
          <button type="button" aria-label="Close fill gradient" onClick={() => setFillOpen(false)}>×</button>
        </div>
        <GradientAssetEditor value={fillGradient.asset}
          onChange={(asset) => onChange({ fillEnabled: true, fillPaint: { ...fillGradient, asset } })} />
        <GradientOptions paint={fillGradient} prefix="" onChange={(fillPaint) => onChange({ fillPaint })} />
      </AnchoredGradientPopover> : null}
    </> : null}
    <ToolOptionColor label="Line" value={style.strokeColor} enabled={style.strokeEnabled}
      allowChangeWhenOff
      onEnabledChange={(strokeEnabled) => onChange({
        strokeEnabled, ...(strokeEnabled ? { strokeColor: style.strokeColor } : {})
      })}
      onChange={(strokeColor) => onChange({ strokeEnabled: true, strokeColor, strokePaint: null })}
      status={<GradientField ref={strokeAnchor}
        value={(strokeGradient ?? createDefaultGradientPaint(
          'vector-stroke-gradient-preview', 'object-bounds'
        )).asset}
        ariaLabel="Edit stroke gradient" title="Edit stroke gradient" expanded={strokeOpen}
        onClick={() => {
          if (!strokeGradient) onChange({
            strokeEnabled: true,
            strokePaint: createDefaultGradientPaint('vector-stroke-gradient', 'object-bounds')
          });
          setStrokeOpen((open) => !open);
        }} />} />
    {strokeGradient && strokeOpen ? <AnchoredGradientPopover anchor={strokeAnchor} ariaLabel="Stroke gradient">
      <div className="lighttable-tool-options__gradient-header">
        <strong>Stroke gradient</strong>
        <button type="button" aria-label="Close stroke gradient" onClick={() => setStrokeOpen(false)}>×</button>
      </div>
      <GradientAssetEditor value={strokeGradient.asset}
        onChange={(asset) => onChange({ strokeEnabled: true, strokePaint: { ...strokeGradient, asset } })} />
      <GradientOptions paint={strokeGradient} prefix="Stroke "
        onChange={(strokePaint) => onChange({ strokePaint })} />
    </AnchoredGradientPopover> : null}
    <ToolOptionNumber label="Weight" min={0.1} max={1000} step={0.5}
      value={style.strokeWidth} unit="px"
      onChange={(value) => onChange({ strokeWidth: Math.max(0.1, value || 0.1) })} />
    <ToolOptionNumber label="Line opacity" min={0} max={100} step={1}
      value={(style.strokeOpacity ?? 1) * 100} unit="%" disabled={!style.strokeEnabled}
      onChange={(value) => onChange({ strokeOpacity: Math.max(0, Math.min(1, value / 100)) })} />
    <ToolOptionSelect label="Style" value={style.strokeStyle ?? 'solid'} disabled={!style.strokeEnabled}
      aria-label="Stroke style"
      onChange={(event) => onChange({
        strokeStyle: event.currentTarget.value as NonNullable<VectorToolStyleSettings['strokeStyle']>
      })}>
      <option value="solid">Solid</option><option value="dashed">Dashed</option>
      <option value="dotted">Dotted</option>
    </ToolOptionSelect>
    <ToolOptionSelect label="Align" value={style.strokeAlignment} disabled={!style.strokeEnabled}
      aria-label="Stroke alignment"
      onChange={(event) => onChange({
        strokeAlignment: event.currentTarget.value as VectorToolStyleSettings['strokeAlignment']
      })}>
      <option value="inside">Inside</option><option value="center">Center</option>
      <option value="outside">Outside</option>
    </ToolOptionSelect>
    <ToolOptionSelect label="Cap" value={style.strokeCap ?? 'round'} disabled={!style.strokeEnabled}
      aria-label="Stroke cap"
      onChange={(event) => onChange({
        strokeCap: event.currentTarget.value as VectorToolStyleSettings['strokeCap']
      })}>
      <option value="butt">Butt</option><option value="round">Round</option>
      <option value="square">Square</option>
    </ToolOptionSelect>
    <ToolOptionSelect label="Join" value={style.strokeJoin ?? 'round'} disabled={!style.strokeEnabled}
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
    <ToolOptionNumber label="Opacity" min={0} max={100} step={1}
      value={(style.opacity ?? 1) * 100} unit="%"
      onChange={(value) => onChange({ opacity: Math.max(0, Math.min(1, value / 100)) })} />
  </div>;
};

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
