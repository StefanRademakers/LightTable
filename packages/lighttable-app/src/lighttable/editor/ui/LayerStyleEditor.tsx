import React from 'react';
import { AdjustmentSlider } from '../../AdjustmentSlider';
import { BLEND_MODES, type BlendMode } from '../document/blendModes';
import {
  cloneLayerStyleStack,
  createDefaultLayerStyle,
  createDefaultLayerStyleGradient,
  layerStyleKindLabels
} from '../styles/layerStyleDefaults';
import type {
  LayerStyleColor,
  LayerStyleId,
  LayerStyleInstance,
  LayerStyleKind,
  LayerStyleStack
} from '../styles/layerStyleTypes';
import { LayerStyleContourEditor } from './LayerStyleContourEditor';
import { LayerStyleGradientEditor } from './LayerStyleGradientEditor';

interface LayerStyleEditorProps {
  mode?: 'dialog' | 'panel';
  layerName: string;
  initialStack: LayerStyleStack;
  initialEffectId?: LayerStyleId;
  onPreview: (stack: LayerStyleStack) => void;
  onCancel?: () => void;
  onCommit?: () => void;
}

const STYLE_KINDS = Object.keys(layerStyleKindLabels) as LayerStyleKind[];

const channelHex = (value: number) =>
  Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0');

const colorHex = (color: LayerStyleColor) =>
  `#${channelHex(color.r)}${channelHex(color.g)}${channelHex(color.b)}`;

const parseHexColor = (value: string, alpha: number): LayerStyleColor => ({
  r: Number.parseInt(value.slice(1, 3), 16) / 255,
  g: Number.parseInt(value.slice(3, 5), 16) / 255,
  b: Number.parseInt(value.slice(5, 7), 16) / 255,
  a: alpha
});

const SelectField: React.FC<{
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => (
  <label className="lighttable-style-field">
    <span>{label}</span>
    <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  </label>
);

const ToggleField: React.FC<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <label className="lighttable-style-toggle">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
    <span>{label}</span>
  </label>
);

const ColorField: React.FC<{
  label: string;
  value: LayerStyleColor;
  onChange: (color: LayerStyleColor) => void;
}> = ({ label, value, onChange }) => (
  <label className="lighttable-style-field">
    <span>{label}</span>
    <span className="lighttable-style-color">
      <input
        type="color"
        value={colorHex(value)}
        onChange={(event) => onChange(parseHexColor(event.currentTarget.value, value.a))}
      />
      <output>{colorHex(value).toUpperCase()}</output>
    </span>
  </label>
);

const ColorSwatch: React.FC<{
  label: string;
  value: LayerStyleColor;
  onChange: (color: LayerStyleColor) => void;
}> = ({ label, value, onChange }) => (
  <label className="lighttable-style-shadow-color" title={label}>
    <input
      type="color"
      value={colorHex(value)}
      aria-label={label}
      onChange={(event) => onChange(parseHexColor(event.currentTarget.value, value.a))}
    />
  </label>
);

const NumberSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  resetValue?: number;
  onChange: (value: number) => void;
}> = ({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  resetValue = 0,
  onChange
}) => (
  <AdjustmentSlider
    label={label}
    value={value}
    min={min}
    max={max}
    step={step}
    resetValue={resetValue}
    format={(current) => `${step < 1 ? current.toFixed(2) : Math.round(current)}${suffix}`}
    onChange={onChange}
    onReset={() => onChange(resetValue)}
  />
);

const normalizeAngle = (value: number) => ((value % 360) + 360) % 360;
const ANGLE_PUBLISH_INTERVAL_MS = 33;
const STYLE_PREVIEW_DELAY_MS = 16;

const AngleField: React.FC<{
  label: string;
  value: number;
  resetValue?: number;
  onChange: (value: number) => void;
}> = ({ label, value, resetValue = 0, onChange }) => {
  const dialRef = React.useRef<HTMLDivElement | null>(null);
  const pointerIdRef = React.useRef<number | null>(null);
  const [displayValue, setDisplayValue] = React.useState(() => normalizeAngle(value));
  const latestValueRef = React.useRef(displayValue);
  const publishedValueRef = React.useRef(displayValue);
  const lastPublishTimeRef = React.useRef(0);
  const publishTimerRef = React.useRef<number | null>(null);
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const normalized = normalizeAngle(displayValue);

  const cancelScheduledPublish = React.useCallback(() => {
    if (publishTimerRef.current === null) return;
    window.clearTimeout(publishTimerRef.current);
    publishTimerRef.current = null;
  }, []);

  const publishLatestValue = React.useCallback((force = false) => {
    const next = latestValueRef.current;
    if (!force && next === publishedValueRef.current) return;
    cancelScheduledPublish();
    publishedValueRef.current = next;
    lastPublishTimeRef.current = performance.now();
    onChangeRef.current(next);
  }, [cancelScheduledPublish]);

  const scheduleValuePublish = React.useCallback(() => {
    const elapsed = performance.now() - lastPublishTimeRef.current;
    if (elapsed >= ANGLE_PUBLISH_INTERVAL_MS) {
      publishLatestValue();
      return;
    }
    if (publishTimerRef.current !== null) return;
    publishTimerRef.current = window.setTimeout(() => {
      publishTimerRef.current = null;
      publishLatestValue();
    }, ANGLE_PUBLISH_INTERVAL_MS - elapsed);
  }, [publishLatestValue]);

  const previewValue = React.useCallback((next: number) => {
    const normalizedNext = normalizeAngle(next);
    latestValueRef.current = normalizedNext;
    setDisplayValue(normalizedNext);
    scheduleValuePublish();
  }, [scheduleValuePublish]);

  const finishPointerInteraction = React.useCallback((pointerId: number) => {
    if (pointerIdRef.current !== pointerId) return;
    pointerIdRef.current = null;
    publishLatestValue(true);
  }, [publishLatestValue]);

  React.useEffect(() => {
    if (pointerIdRef.current !== null) return;
    const next = normalizeAngle(value);
    latestValueRef.current = next;
    publishedValueRef.current = next;
    setDisplayValue(next);
  }, [value]);

  React.useEffect(() => cancelScheduledPublish, [cancelScheduledPublish]);

  const updateFromPointer = (clientX: number, clientY: number) => {
    const bounds = dialRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = clientX - (bounds.left + bounds.width / 2);
    const y = clientY - (bounds.top + bounds.height / 2);
    if (Math.hypot(x, y) < 1) return;
    previewValue(Math.atan2(-y, x) * 180 / Math.PI);
  };

  return (
    <div className="lighttable-style-angle">
      <span className="lighttable-style-angle__controls">
        <div
          ref={dialRef}
          className="lighttable-style-angle__dial"
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={359}
          aria-valuenow={Math.round(normalized)}
          aria-valuetext={`${Math.round(normalized)} degrees`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            pointerIdRef.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            updateFromPointer(event.clientX, event.clientY);
          }}
          onPointerMove={(event) => {
            if (pointerIdRef.current === event.pointerId) {
              updateFromPointer(event.clientX, event.clientY);
            }
          }}
          onPointerUp={(event) => {
            finishPointerInteraction(event.pointerId);
          }}
          onPointerCancel={(event) => {
            finishPointerInteraction(event.pointerId);
          }}
          onLostPointerCapture={(event) => finishPointerInteraction(event.pointerId)}
          onDoubleClick={() => onChange(resetValue)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 10 : 1;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
              event.preventDefault();
              onChange(normalizeAngle(normalized - step));
            } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault();
              onChange(normalizeAngle(normalized + step));
            } else if (event.key === 'Home') {
              event.preventDefault();
              onChange(resetValue);
            }
          }}
        >
          <span
            className="lighttable-style-angle__hand"
            style={{ transform: `rotate(${-normalized}deg)` }}
            aria-hidden="true"
          />
        </div>
        <span className="lighttable-style-angle__number">
          <input
            type="number"
            min={0}
            max={359}
            step={1}
            value={Math.round(normalized)}
            aria-label={`${label} degrees`}
            onChange={(event) => {
              const next = event.currentTarget.valueAsNumber;
              if (Number.isFinite(next)) onChange(normalizeAngle(next));
            }}
          />
          <span>°</span>
        </span>
      </span>
    </div>
  );
};

const CommonControls: React.FC<{
  effect: LayerStyleInstance;
  patch: (patch: Partial<LayerStyleInstance>) => void;
}> = ({ effect, patch }) => (
  <div className="lighttable-style-section">
    <h4>Blend</h4>
    <SelectField
      label="Mode"
      value={effect.blendMode}
      options={BLEND_MODES.map((mode) => ({ value: mode.id, label: mode.label }))}
      onChange={(blendMode) => patch({ blendMode: blendMode as BlendMode })}
    />
    <NumberSlider
      label="Opacity"
      value={effect.opacity * 100}
      min={0}
      max={100}
      suffix="%"
      resetValue={100}
      onChange={(opacity) => patch({ opacity: opacity / 100 })}
    />
  </div>
);

const QualityControls: React.FC<{
  effect: Extract<LayerStyleInstance, { noise: number }>;
  patch: (patch: Partial<LayerStyleInstance>) => void;
}> = ({ effect, patch }) => (
  <div className="lighttable-style-section">
    <h4>Quality</h4>
    <ToggleField
      label="Anti-alias"
      checked={effect.antiAlias}
      onChange={(antiAlias) => patch({ antiAlias })}
    />
    <NumberSlider
      label="Noise"
      value={effect.noise * 100}
      min={0}
      max={100}
      suffix="%"
      onChange={(noise) => patch({ noise: noise / 100 })}
    />
    <LayerStyleContourEditor
      value={effect.contour}
      onChange={(contour) => patch({ contour })}
    />
  </div>
);

const DirectionControls: React.FC<{
  effect: Extract<LayerStyleInstance, { angle: number; distance: number }>;
  patch: (patch: Partial<LayerStyleInstance>) => void;
}> = ({ effect, patch }) => (
  <div className="lighttable-style-section">
    <h4>Position</h4>
    {'useGlobalLight' in effect ? (
      <ToggleField
        label="Use global light"
        checked={effect.useGlobalLight}
        onChange={(useGlobalLight) => patch({ useGlobalLight })}
      />
    ) : null}
    <NumberSlider
      label="Angle"
      value={effect.angle}
      min={0}
      max={359}
      suffix="°"
      resetValue={120}
      onChange={(angle) => patch({ angle })}
    />
    <NumberSlider
      label="Distance"
      value={effect.distance}
      min={0}
      max={250}
      suffix=" px"
      resetValue={5}
      onChange={(distance) => patch({ distance })}
    />
  </div>
);

const DropShadowControls: React.FC<{
  effect: Extract<LayerStyleInstance, { kind: 'drop-shadow' }>;
  patch: (patch: Partial<LayerStyleInstance>) => void;
}> = ({ effect, patch }) => (
  <>
    <div className="lighttable-style-section">
      <h4>Shadow</h4>
      <NumberSlider
        label="Blur"
        value={effect.size}
        min={0}
        max={250}
        suffix=" px"
        resetValue={30}
        onChange={(size) => patch({ size })}
      />
      <NumberSlider
        label="Distance"
        value={effect.distance}
        min={0}
        max={250}
        suffix=" px"
        resetValue={30}
        onChange={(distance) => patch({ distance })}
      />
      <NumberSlider
        label="Opacity"
        value={effect.opacity * 100}
        min={0}
        max={100}
        suffix="%"
        resetValue={35}
        onChange={(opacity) => patch({ opacity: opacity / 100 })}
      />
      <div className="lighttable-style-shadow-appearance">
        <ColorSwatch
          label="Shadow color"
          value={effect.color}
          onChange={(color) => patch({ color })}
        />
        <AngleField
          label="Angle"
          value={effect.angle}
          resetValue={120}
          onChange={(angle) => patch({ angle })}
        />
      </div>
    </div>
    <details className="lighttable-style-advanced">
      <summary>Advanced</summary>
      <div className="lighttable-style-advanced__content">
        <SelectField
          label="Blend mode"
          value={effect.blendMode}
          options={BLEND_MODES.map((mode) => ({ value: mode.id, label: mode.label }))}
          onChange={(blendMode) => patch({ blendMode: blendMode as BlendMode })}
        />
        <NumberSlider
          label="Spread"
          value={effect.spread * 100}
          min={0}
          max={100}
          suffix="%"
          onChange={(spread) => patch({ spread: spread / 100 })}
        />
        <ToggleField
          label="Use global light"
          checked={effect.useGlobalLight}
          onChange={(useGlobalLight) => patch({ useGlobalLight })}
        />
        <ToggleField
          label="Layer knocks out shadow"
          checked={effect.layerKnocksOut}
          onChange={(layerKnocksOut) => patch({ layerKnocksOut })}
        />
        <ToggleField
          label="Anti-alias"
          checked={effect.antiAlias}
          onChange={(antiAlias) => patch({ antiAlias })}
        />
        <NumberSlider
          label="Noise"
          value={effect.noise * 100}
          min={0}
          max={100}
          suffix="%"
          onChange={(noise) => patch({ noise: noise / 100 })}
        />
        <LayerStyleContourEditor
          value={effect.contour}
          onChange={(contour) => patch({ contour })}
        />
      </div>
    </details>
  </>
);

const EffectControls: React.FC<{
  effect: LayerStyleInstance;
  patch: (patch: Partial<LayerStyleInstance>) => void;
}> = ({ effect, patch }) => {
  const common = <CommonControls effect={effect} patch={patch} />;
  switch (effect.kind) {
    case 'color-overlay':
      return <>{common}<div className="lighttable-style-section"><h4>Color</h4>
        <ColorField label="Color" value={effect.color} onChange={(color) => patch({ color })} />
      </div></>;
    case 'drop-shadow':
      return <DropShadowControls effect={effect} patch={patch} />;
    case 'inner-shadow':
      return <>{common}
        <div className="lighttable-style-section"><h4>Color</h4>
          <ColorField label="Color" value={effect.color} onChange={(color) => patch({ color })} />
        </div>
        <DirectionControls effect={effect} patch={patch} />
        <div className="lighttable-style-section"><h4>Structure</h4>
          <NumberSlider
            label="Choke"
            value={effect.choke * 100}
            min={0}
            max={100}
            suffix="%"
            onChange={(choke) => patch({ choke: choke / 100 })}
          />
          <NumberSlider label="Size" value={effect.size} min={0} max={250} suffix=" px"
            resetValue={8} onChange={(size) => patch({ size })} />
        </div>
        <QualityControls effect={effect} patch={patch} />
      </>;
    case 'outer-glow':
    case 'inner-glow':
      return <>{common}
        <div className="lighttable-style-section"><h4>Color</h4>
          <SelectField label="Source" value={effect.gradient ? 'gradient' : 'color'} options={[
            { value: 'color', label: 'Color' }, { value: 'gradient', label: 'Gradient' }
          ]} onChange={(source) => patch({
            gradient: source === 'gradient' ? effect.gradient ?? createDefaultLayerStyleGradient() : null
          })} />
          {effect.gradient ? (
            <LayerStyleGradientEditor
              value={effect.gradient}
              onChange={(gradient) => patch({ gradient })}
            />
          ) : (
            <ColorField label="Color" value={effect.color} onChange={(color) => patch({ color })} />
          )}
          <SelectField label="Technique" value={effect.technique} options={[
            { value: 'softer', label: 'Softer' }, { value: 'precise', label: 'Precise' }
          ]} onChange={(technique) => patch({ technique: technique as 'softer' | 'precise' })} />
          {effect.kind === 'inner-glow' ? (
            <SelectField label="Source" value={effect.source} options={[
              { value: 'edge', label: 'Edge' }, { value: 'center', label: 'Center' }
            ]} onChange={(source) => patch({ source: source as 'edge' | 'center' })} />
          ) : null}
        </div>
        <div className="lighttable-style-section"><h4>Structure</h4>
          <NumberSlider label={effect.kind === 'outer-glow' ? 'Spread' : 'Choke'}
            value={effect.choke * 100} min={0} max={100} suffix="%"
            onChange={(choke) => patch({ choke: choke / 100 })} />
          <NumberSlider label="Size" value={effect.size} min={0} max={250} suffix=" px"
            resetValue={7} onChange={(size) => patch({ size })} />
          <NumberSlider label="Range" value={effect.range * 100} min={1} max={100} suffix="%"
            resetValue={50} onChange={(range) => patch({ range: range / 100 })} />
          <NumberSlider label="Jitter" value={effect.jitter * 100} min={0} max={100} suffix="%"
            onChange={(jitter) => patch({ jitter: jitter / 100 })} />
        </div>
        <QualityControls effect={effect} patch={patch} />
      </>;
    case 'stroke': {
      const gradientFill = effect.fill.type === 'gradient' ? effect.fill : null;
      return <>{common}
        <div className="lighttable-style-section"><h4>Stroke</h4>
          <NumberSlider label="Size" value={effect.size} min={1} max={250} suffix=" px"
            resetValue={3} onChange={(size) => patch({ size })} />
          <SelectField label="Position" value={effect.position} options={[
            { value: 'inside', label: 'Inside' }, { value: 'center', label: 'Center' },
            { value: 'outside', label: 'Outside' }
          ]} onChange={(position) => patch({ position: position as typeof effect.position })} />
          <SelectField label="Fill" value={effect.fill.type} options={[
            { value: 'color', label: 'Color' }, { value: 'gradient', label: 'Gradient' },
            { value: 'pattern', label: 'Pattern' }
          ]} onChange={(fillType) => {
            if (fillType === effect.fill.type) return;
            if (fillType === 'color') {
              patch({ fill: { type: 'color', color: { r: 1, g: 1, b: 1, a: 1 } } });
            } else if (fillType === 'gradient') {
              patch({ fill: {
                type: 'gradient',
                gradient: createDefaultLayerStyleGradient(),
                dither: false,
                reverse: false,
                style: 'linear',
                alignWithLayer: true,
                angle: 90,
                scale: 1,
                offsetX: 0,
                offsetY: 0,
                method: 'perceptual'
              } });
            } else {
              patch({ fill: { type: 'pattern', pattern: null, scale: 1, angle: 0 } });
            }
          }} />
          {effect.fill.type === 'color' ? (
            <ColorField label="Color" value={effect.fill.color}
              onChange={(color) => patch({ fill: { type: 'color', color } })} />
          ) : effect.fill.type === 'gradient' ? (
            <LayerStyleGradientEditor
              value={effect.fill.gradient}
              onChange={(gradient) => gradientFill && patch({ fill: { ...gradientFill, gradient } })}
            />
          ) : (
            <div className="lighttable-style-notice">
              Pattern Stroke is preserved but remains inactive until its asset is
              resolved by the document registry.
            </div>
          )}
          {gradientFill ? (
            <>
              <SelectField label="Style" value={gradientFill.style} options={[
                { value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' },
                { value: 'angle', label: 'Angle' }, { value: 'reflected', label: 'Reflected' },
                { value: 'diamond', label: 'Diamond' }
              ]} onChange={(style) => patch({
                fill: { ...gradientFill, style: style as typeof gradientFill.style }
              })} />
              <NumberSlider label="Angle" value={gradientFill.angle} min={0} max={359} suffix="°"
                resetValue={90} onChange={(angle) => patch({ fill: { ...gradientFill, angle } })} />
              <NumberSlider label="Scale" value={gradientFill.scale * 100} min={10} max={500}
                suffix="%" resetValue={100}
                onChange={(scale) => patch({ fill: { ...gradientFill, scale: scale / 100 } })} />
              <ToggleField label="Reverse" checked={gradientFill.reverse}
                onChange={(reverse) => patch({ fill: { ...gradientFill, reverse } })} />
              <ToggleField label="Dither" checked={gradientFill.dither}
                onChange={(dither) => patch({ fill: { ...gradientFill, dither } })} />
            </>
          ) : null}
          <ToggleField label="Overprint" checked={effect.overprint}
            onChange={(overprint) => patch({ overprint })} />
        </div>
      </>;
    }
    case 'gradient-overlay': {
      return <>{common}
        <div className="lighttable-style-section"><h4>Gradient</h4>
          <LayerStyleGradientEditor
            value={effect.gradient}
            onChange={(gradient) => patch({ gradient })}
          />
          <SelectField label="Style" value={effect.style} options={[
            { value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' },
            { value: 'angle', label: 'Angle' }, { value: 'reflected', label: 'Reflected' },
            { value: 'diamond', label: 'Diamond' }
          ]} onChange={(style) => patch({ style: style as typeof effect.style })} />
          <NumberSlider label="Angle" value={effect.angle} min={0} max={359} suffix="°"
            resetValue={90} onChange={(angle) => patch({ angle })} />
          <NumberSlider label="Scale" value={effect.scale * 100} min={10} max={500} suffix="%"
            resetValue={100} onChange={(scale) => patch({ scale: scale / 100 })} />
          <ToggleField label="Reverse" checked={effect.reverse}
            onChange={(reverse) => patch({ reverse })} />
          <ToggleField label="Dither" checked={effect.dither}
            onChange={(dither) => patch({ dither })} />
          <ToggleField label="Align with layer" checked={effect.alignWithLayer}
            onChange={(alignWithLayer) => patch({ alignWithLayer })} />
        </div>
      </>;
    }
    case 'satin':
      return <>{common}
        <div className="lighttable-style-section"><h4>Satin</h4>
          <ColorField label="Color" value={effect.color} onChange={(color) => patch({ color })} />
          <DirectionControls effect={effect} patch={patch} />
          <NumberSlider label="Size" value={effect.size} min={1} max={250} suffix=" px"
            resetValue={60} onChange={(size) => patch({ size })} />
          <ToggleField label="Anti-alias" checked={effect.antiAlias}
            onChange={(antiAlias) => patch({ antiAlias })} />
          <ToggleField label="Invert" checked={effect.invert}
            onChange={(invert) => patch({ invert })} />
          <LayerStyleContourEditor value={effect.contour}
            onChange={(contour) => patch({ contour })} />
        </div>
      </>;
    case 'bevel-emboss':
      return <>{common}
        <div className="lighttable-style-section"><h4>Structure</h4>
          <SelectField label="Style" value={effect.style} options={[
            { value: 'outer-bevel', label: 'Outer Bevel' }, { value: 'inner-bevel', label: 'Inner Bevel' },
            { value: 'emboss', label: 'Emboss' }, { value: 'pillow-emboss', label: 'Pillow Emboss' },
            { value: 'stroke-emboss', label: 'Stroke Emboss' }
          ]} onChange={(style) => patch({ style: style as typeof effect.style })} />
          <SelectField label="Technique" value={effect.technique} options={[
            { value: 'smooth', label: 'Smooth' }, { value: 'chisel-hard', label: 'Chisel Hard' },
            { value: 'chisel-soft', label: 'Chisel Soft' }
          ]} onChange={(technique) => patch({ technique: technique as typeof effect.technique })} />
          <NumberSlider label="Depth" value={effect.depth * 100} min={1} max={1000} suffix="%"
            resetValue={100} onChange={(depth) => patch({ depth: depth / 100 })} />
          <SelectField label="Direction" value={effect.direction} options={[
            { value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }
          ]} onChange={(direction) => patch({ direction: direction as 'up' | 'down' })} />
          <NumberSlider label="Size" value={effect.size} min={1} max={250} suffix=" px"
            resetValue={5} onChange={(size) => patch({ size })} />
          <NumberSlider label="Soften" value={effect.soften} min={0} max={16} suffix=" px"
            onChange={(soften) => patch({ soften })} />
        </div>
        <div className="lighttable-style-section"><h4>Shading</h4>
          <ToggleField label="Use global light" checked={effect.useGlobalLight}
            onChange={(useGlobalLight) => patch({ useGlobalLight })} />
          <NumberSlider label="Angle" value={effect.angle} min={0} max={359} suffix="°"
            resetValue={120} onChange={(angle) => patch({ angle })} />
          <NumberSlider label="Altitude" value={effect.altitude} min={0} max={90} suffix="°"
            resetValue={30} onChange={(altitude) => patch({ altitude })} />
          <ColorField label="Highlight" value={effect.highlightColor}
            onChange={(highlightColor) => patch({ highlightColor })} />
          <NumberSlider label="Highlight opacity" value={effect.highlightOpacity * 100}
            min={0} max={100} suffix="%" resetValue={75}
            onChange={(highlightOpacity) => patch({ highlightOpacity: highlightOpacity / 100 })} />
          <ColorField label="Shadow" value={effect.shadowColor}
            onChange={(shadowColor) => patch({ shadowColor })} />
          <NumberSlider label="Shadow opacity" value={effect.shadowOpacity * 100}
            min={0} max={100} suffix="%" resetValue={75}
            onChange={(shadowOpacity) => patch({ shadowOpacity: shadowOpacity / 100 })} />
          <LayerStyleContourEditor value={effect.contour}
            onChange={(contour) => patch({ contour })} />
        </div>
        <div className="lighttable-style-section"><h4>Texture</h4>
          <ToggleField label="Use texture" checked={effect.texture.enabled}
            onChange={(enabled) => patch({ texture: { ...effect.texture, enabled } })} />
          <NumberSlider label="Scale" value={effect.texture.scale * 100}
            min={1} max={1000} suffix="%" resetValue={100}
            onChange={(scale) => patch({ texture: { ...effect.texture, scale: scale / 100 } })} />
          <NumberSlider label="Depth" value={effect.texture.depth * 100}
            min={-1000} max={1000} suffix="%" resetValue={100}
            onChange={(depth) => patch({ texture: { ...effect.texture, depth: depth / 100 } })} />
          <ToggleField label="Invert" checked={effect.texture.invert}
            onChange={(invert) => patch({ texture: { ...effect.texture, invert } })} />
          <ToggleField label="Link with layer" checked={effect.texture.linkWithLayer}
            onChange={(linkWithLayer) => patch({ texture: { ...effect.texture, linkWithLayer } })} />
          <div className="lighttable-style-notice">
            {effect.texture.pattern?.assetId
              ? `Resolved pattern: ${effect.texture.pattern.name}`
              : effect.texture.pattern
                ? `Preserved unresolved pattern: ${effect.texture.pattern.name}`
                : 'No texture pattern selected.'}
          </div>
        </div>
      </>;
    case 'pattern-overlay':
      return <>{common}<div className="lighttable-style-section"><h4>Pattern</h4>
        <NumberSlider label="Angle" value={effect.angle} min={0} max={359} suffix="°"
          onChange={(angle) => patch({ angle })} />
        <NumberSlider label="Scale" value={effect.scale * 100} min={1} max={1000}
          suffix="%" resetValue={100} onChange={(scale) => patch({ scale: scale / 100 })} />
        <ToggleField label="Link with layer" checked={effect.linkWithLayer}
          onChange={(linkWithLayer) => patch({ linkWithLayer })} />
        <div className="lighttable-style-notice">
          {effect.pattern
            ? `Preserved unresolved pattern: ${effect.pattern.name}`
            : 'Choose a pattern after the document asset registry is available.'}
          {' '}The renderer does not substitute a fake pattern.
        </div>
      </div></>;
  }
};

export const LayerStyleEditor: React.FC<LayerStyleEditorProps> = ({
  mode = 'dialog',
  layerName,
  initialStack,
  initialEffectId,
  onPreview,
  onCancel,
  onCommit
}) => {
  const [draft, setDraft] = React.useState(() => cloneLayerStyleStack(initialStack));
  const draftRef = React.useRef(draft);
  const publishedRevisionRef = React.useRef(initialStack.revision);
  const latestPreviewRef = React.useRef<LayerStyleStack | null>(null);
  const previewTimerRef = React.useRef<number | null>(null);
  const onPreviewRef = React.useRef(onPreview);
  onPreviewRef.current = onPreview;
  const [selectedId, setSelectedId] = React.useState<LayerStyleId | null>(
    initialEffectId ?? initialStack.effects.at(-1)?.id ?? null
  );
  const [newKind, setNewKind] = React.useState<LayerStyleKind>('drop-shadow');
  const selected = draft.effects.find((effect) => effect.id === selectedId) ?? null;

  const cancelScheduledPreview = React.useCallback(() => {
    if (previewTimerRef.current === null) return;
    window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
  }, []);

  const publishLatestPreview = React.useCallback(() => {
    cancelScheduledPreview();
    const next = latestPreviewRef.current;
    if (!next) return;
    latestPreviewRef.current = null;
    onPreviewRef.current(next);
  }, [cancelScheduledPreview]);

  const schedulePreview = React.useCallback(() => {
    if (previewTimerRef.current !== null) return;
    // Let the local inspector state paint before document synchronization and
    // GPU style invalidation. Repeated control events retain only the newest
    // complete stack, preventing a render backlog on large documents.
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      publishLatestPreview();
    }, STYLE_PREVIEW_DELAY_MS);
  }, [publishLatestPreview]);

  React.useEffect(() => {
    if (initialEffectId && draft.effects.some((effect) => effect.id === initialEffectId)) {
      setSelectedId(initialEffectId);
    }
  // The requested row changes only when the Layers panel opens a specific
  // effect. Draft edits must not force selection back to that row.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEffectId]);

  React.useEffect(() => {
    if (initialStack.revision === publishedRevisionRef.current) return;
    cancelScheduledPreview();
    latestPreviewRef.current = null;
    publishedRevisionRef.current = initialStack.revision;
    const next = cloneLayerStyleStack(initialStack);
    draftRef.current = next;
    setDraft(next);
    setSelectedId((current) => (
      current && next.effects.some((effect) => effect.id === current)
        ? current
        : next.effects.at(-1)?.id ?? null
    ));
  }, [cancelScheduledPreview, initialStack]);

  React.useEffect(() => () => {
    publishLatestPreview();
  }, [publishLatestPreview]);

  const updateDraft = (updater: (current: LayerStyleStack) => LayerStyleStack) => {
    const current = draftRef.current;
    const next = updater(current);
    if (next === current) return;
    draftRef.current = next;
    publishedRevisionRef.current = next.revision;
    latestPreviewRef.current = next;
    setDraft(next);
    schedulePreview();
  };

  const patchSelected = (patch: Partial<LayerStyleInstance>) => {
    if (!selectedId) return;
    updateDraft((current) => ({
      ...current,
      effects: current.effects.map((effect) =>
        effect.id === selectedId ? { ...effect, ...patch } as LayerStyleInstance : effect
      ),
      revision: current.revision + 1
    }));
  };

  const addStyle = () => {
    const effect = createDefaultLayerStyle(newKind);
    updateDraft((current) => ({
      ...current,
      enabled: true,
      effects: [...current.effects, effect],
      revision: current.revision + 1
    }));
    setSelectedId(effect.id);
  };

  const removeEffect = (effectId: LayerStyleId) => {
    const index = draft.effects.findIndex((effect) => effect.id === effectId);
    if (index < 0) return;
    const nextId = draft.effects[index - 1]?.id ?? draft.effects[index + 1]?.id ?? null;
    updateDraft((current) => ({
      ...current,
      effects: current.effects.filter((effect) => effect.id !== effectId),
      revision: current.revision + 1
    }));
    if (selectedId === effectId) setSelectedId(nextId);
  };

  const moveSelected = (direction: -1 | 1) => {
    if (!selectedId) return;
    updateDraft((current) => {
      const index = current.effects.findIndex((effect) => effect.id === selectedId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.effects.length) return current;
      const effects = [...current.effects];
      [effects[index], effects[target]] = [effects[target], effects[index]];
      return { ...current, effects, revision: current.revision + 1 };
    });
  };

  return (
    <div
      className={`lighttable-style-editor${mode === 'panel' ? ' lighttable-style-editor--panel' : ''}`}
      role={mode === 'dialog' ? 'dialog' : 'region'}
      aria-modal={mode === 'dialog' ? true : undefined}
      aria-label="Layer Style"
    >
      {mode === 'dialog' ? (
        <header>
          <div>
            <strong>Layer Style</strong>
            <span>{layerName}</span>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close Layer Style editor">×</button>
        </header>
      ) : null}
      <div className="lighttable-style-editor__body">
        <aside>
          <label className="lighttable-style-stack-toggle">
            <input type="checkbox" checked={draft.enabled}
              onChange={(event) => updateDraft((current) => ({
                ...current,
                enabled: event.currentTarget.checked,
                revision: current.revision + 1
              }))} />
            <span>Effects</span>
          </label>
          <div className="lighttable-style-editor__effect-list">
            {[...draft.effects].reverse().map((effect) => (
              <div
                key={effect.id}
                className={effect.id === selectedId ? 'lighttable-style-editor__effect--active' : ''}
              >
                <input
                  type="checkbox"
                  checked={effect.enabled}
                  aria-label={`${effect.enabled ? 'Disable' : 'Enable'} ${effect.name}`}
                  onChange={(event) => {
                    const enabled = event.currentTarget.checked;
                    updateDraft((current) => ({
                      ...current,
                      effects: current.effects.map((candidate) => candidate.id === effect.id
                        ? { ...candidate, enabled }
                        : candidate),
                      revision: current.revision + 1
                    }));
                  }}
                />
                <button type="button" onClick={() => setSelectedId(effect.id)}>
                  {effect.name}
                </button>
                <button
                  type="button"
                  className="lighttable-style-editor__effect-remove"
                  aria-label={`Remove ${effect.name}`}
                  title={`Remove ${effect.name}`}
                  onClick={() => removeEffect(effect.id)}
                >×</button>
              </div>
            ))}
          </div>
          <div className="lighttable-style-editor__add">
            <select value={newKind} onChange={(event) => setNewKind(event.currentTarget.value as LayerStyleKind)}>
              {STYLE_KINDS.map((kind) => <option key={kind} value={kind}>{layerStyleKindLabels[kind]}</option>)}
            </select>
            <button type="button" onClick={addStyle}>Add</button>
          </div>
        </aside>
        <main>
          {selected ? (
            <>
              <div className="lighttable-style-editor__effect-heading">
                <h3>{selected.name}</h3>
                <div>
                  <button type="button" onClick={() => moveSelected(1)}
                    disabled={draft.effects.at(-1)?.id === selectedId}
                    title="Move effect up">↑</button>
                  <button type="button" onClick={() => moveSelected(-1)}
                    disabled={draft.effects[0]?.id === selectedId}
                    title="Move effect down">↓</button>
                </div>
              </div>
              <EffectControls effect={selected} patch={patchSelected} />
            </>
          ) : (
            <div className="lighttable-style-editor__empty">
              Add an effect to start styling this layer.
            </div>
          )}
        </main>
      </div>
      <footer>
        <div className="lighttable-style-editor__scale">
          <NumberSlider label="Scale effects" value={draft.scale * 100} min={1} max={1000}
            suffix="%" resetValue={100}
            onChange={(scale) => updateDraft((current) => ({
              ...current,
              scale: scale / 100,
              revision: current.revision + 1
            }))} />
        </div>
        {mode === 'dialog' ? (
          <>
            <button type="button" onClick={onCancel}>Cancel</button>
            <button type="button" className="lighttable-style-editor__primary" onClick={onCommit}>OK</button>
          </>
        ) : null}
      </footer>
    </div>
  );
};
