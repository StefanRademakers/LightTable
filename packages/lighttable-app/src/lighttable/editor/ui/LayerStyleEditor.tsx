import { Checkbox, PanelSection, IconButton, MaskIcon, PanelSectionHeader, Button,
  SelectField } from '@lighttable/ui';
import { ButtonBase } from '../../../ui/ButtonBase';
import React from 'react';
import { lightTableIcon } from '../../../assets/icons';
import { SwitchControl } from '@lighttable/ui';
import { Select } from '@lighttable/ui';
import { EffectPanel } from '../../effects/EffectPanel';
import { BLEND_MODES, type BlendMode } from '../document/blendModes';
import {
  cloneLayerStyleStack,
  createDefaultLayerStyle,
  createDefaultLayerStyleGradient,
  layerStyleKindLabels
} from '../styles/layerStyleDefaults';
import type {
  LayerStyleId,
  LayerStyleInstance,
  LayerStyleKind,
  LayerStyleStack
} from '../styles/layerStyleTypes';
import { LayerStyleContourEditor } from './LayerStyleContourEditor';
import { LayerStyleGradientEditor } from './LayerStyleGradientEditor';
import {
  PanelAngleControl as AngleField,
  PanelCheckboxField as ToggleField,
  PanelColorSwatch as ColorSwatch,
  PanelNumberSlider as NumberSlider
} from '../../../ui/PanelControls';

interface LayerStyleEditorProps {
  mode?: 'dialog' | 'panel';
  layerName: string;
  initialStack: LayerStyleStack;
  initialEffectId?: LayerStyleId;
  previewIntervalMs?: number;
  onPreview: (stack: LayerStyleStack) => void;
  onCancel?: () => void;
  onCommit?: () => void;
}

const STYLE_KINDS = Object.keys(layerStyleKindLabels) as LayerStyleKind[];

// Style controls update their local UI at native input speed. Publishing a
// complete document/style snapshot faster than an interactive render frame
// only creates React and GPU invalidation backlog. Simple documents keep the
// normal 30 Hz contract; the panel can select a slower newest-only cadence for
// complex documents. Pointer-up still flushes the exact final value.
export const LAYER_STYLE_PREVIEW_INTERVAL_MS = 33;

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
      onChange={(angle) => patch({ angle, useGlobalLight: false })}
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

type ShadowStyle = Extract<LayerStyleInstance, { kind: 'drop-shadow' | 'inner-shadow' }>;

const ShadowControls: React.FC<{
  effect: ShadowStyle;
  patch: (patch: Partial<LayerStyleInstance>) => void;
}> = ({ effect, patch }) => {
  const dropShadow = effect.kind === 'drop-shadow';
  return <>
    <div className="lighttable-style-section">
      <h4>Shadow</h4>
      <NumberSlider
        label="Blur"
        value={effect.size}
        min={0}
        max={250}
        suffix=" px"
        resetValue={dropShadow ? 30 : 7}
        onChange={(size) => patch({ size })}
      />
      <NumberSlider
        label="Distance"
        value={effect.distance}
        min={0}
        max={250}
        suffix=" px"
        resetValue={dropShadow ? 30 : 3}
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
          label={dropShadow ? 'Shadow color' : 'Inner shadow color'}
          value={effect.color}
          inline
          onChange={(color) => patch({ color })}
        />
        <AngleField
          label="Angle"
          value={effect.angle}
          resetValue={120}
          onChange={(angle) => patch({ angle, useGlobalLight: false })}
        />
      </div>
    </div>
    <PanelSection label="Advanced" variant="disclosure" keepMounted contentClassName="lighttable-property-stack">
        <SelectField
          label="Blend mode"
          value={effect.blendMode}
          options={BLEND_MODES.map((mode) => ({ value: mode.id, label: mode.label }))}
          onChange={(blendMode) => patch({ blendMode: blendMode as BlendMode })}
        />
        <NumberSlider
          label={dropShadow ? 'Spread' : 'Choke'}
          value={(dropShadow ? effect.spread : effect.choke) * 100}
          min={0}
          max={100}
          suffix="%"
          onChange={(amount) => patch(dropShadow
            ? { spread: amount / 100 }
            : { choke: amount / 100 })}
        />
        <ToggleField
          label="Use global light"
          checked={effect.useGlobalLight}
          onChange={(useGlobalLight) => patch({ useGlobalLight })}
        />
        {dropShadow ? (
          <ToggleField
            label="Layer knocks out shadow"
            checked={effect.layerKnocksOut}
            onChange={(layerKnocksOut) => patch({ layerKnocksOut })}
          />
        ) : null}
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
    </PanelSection>
  </>;
};

type StrokeStyle = Extract<LayerStyleInstance, { kind: 'stroke' }>;

type GlowStyle = Extract<LayerStyleInstance, { kind: 'outer-glow' | 'inner-glow' }>;

const GlowControls: React.FC<{
  effect: GlowStyle;
  patch: (patch: Partial<LayerStyleInstance>) => void;
}> = ({ effect, patch }) => {
  const innerGlow = effect.kind === 'inner-glow';
  return <>
    <div className="lighttable-style-section">
      <h4>Glow</h4>
      <NumberSlider label="Opacity" value={effect.opacity * 100} min={0} max={100}
        suffix="%" resetValue={35} onChange={(opacity) => patch({ opacity: opacity / 100 })} />
      {effect.gradient ? (
        <LayerStyleGradientEditor value={effect.gradient}
          onChange={(gradient) => patch({ gradient })} />
      ) : (
        <ColorSwatch label="Color" value={effect.color}
          onChange={(color) => patch({ color })} />
      )}
      <NumberSlider label="Size" value={effect.size} min={0} max={250} suffix=" px"
        resetValue={7} onChange={(size) => patch({ size })} />
      {innerGlow ? (
        <SelectField label="Source" value={effect.source} options={[
          { value: 'edge', label: 'Edge' }, { value: 'center', label: 'Center' }
        ]} onChange={(source) => patch({ source: source as typeof effect.source })} />
      ) : null}
    </div>
    <PanelSection label="Advanced" variant="disclosure" keepMounted contentClassName="lighttable-property-stack">
      <SelectField label="Fill" value={effect.gradient ? 'gradient' : 'color'} options={[
        { value: 'color', label: 'Color' }, { value: 'gradient', label: 'Gradient' }
      ]} onChange={(fill) => patch({
        gradient: fill === 'gradient' ? effect.gradient ?? createDefaultLayerStyleGradient() : null
      })} />
      <SelectField label="Blend mode" value={effect.blendMode}
        options={BLEND_MODES.map((mode) => ({ value: mode.id, label: mode.label }))}
        onChange={(blendMode) => patch({ blendMode: blendMode as BlendMode })} />
      <SelectField label="Technique" value={effect.technique} options={[
        { value: 'softer', label: 'Softer' }, { value: 'precise', label: 'Precise' }
      ]} onChange={(technique) => patch({ technique: technique as typeof effect.technique })} />
      <NumberSlider label={innerGlow ? 'Choke' : 'Spread'} value={effect.choke * 100}
        min={0} max={100} suffix="%" resetValue={0}
        onChange={(choke) => patch({ choke: choke / 100 })} />
      <NumberSlider label="Range" value={effect.range * 100} min={1} max={100}
        suffix="%" resetValue={100} onChange={(range) => patch({ range: range / 100 })} />
      <NumberSlider label="Jitter" value={effect.jitter * 100} min={0} max={100}
        suffix="%" resetValue={0} onChange={(jitter) => patch({ jitter: jitter / 100 })} />
      <ToggleField label="Anti-alias" checked={effect.antiAlias}
        onChange={(antiAlias) => patch({ antiAlias })} />
      <NumberSlider label="Noise" value={effect.noise * 100} min={0} max={100}
        suffix="%" resetValue={0} onChange={(noise) => patch({ noise: noise / 100 })} />
      <LayerStyleContourEditor value={effect.contour}
        onChange={(contour) => patch({ contour })} />
    </PanelSection>
  </>;
};

const StrokeControls: React.FC<{
  effect: StrokeStyle;
  patch: (patch: Partial<LayerStyleInstance>) => void;
}> = ({ effect, patch }) => {
  const gradientFill = effect.fill.type === 'gradient' ? effect.fill : null;
  const changeFillType = (fillType: string) => {
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
  };

  return <>
    <div className="lighttable-style-section">
      <h4>Stroke</h4>
      <SelectField label="Fill" value={effect.fill.type} options={[
        { value: 'color', label: 'Color' }, { value: 'gradient', label: 'Gradient' },
        { value: 'pattern', label: 'Pattern' }
      ]} onChange={changeFillType} />
      <SelectField label="Position" value={effect.position} options={[
        { value: 'inside', label: 'Inside' }, { value: 'center', label: 'Center' },
        { value: 'outside', label: 'Outside' }
      ]} onChange={(position) => patch({ position: position as typeof effect.position })} />
      <NumberSlider label="Size" value={effect.size} min={1} max={250} suffix=" px"
        resetValue={3} onChange={(size) => patch({ size })} />
      {effect.fill.type === 'color' ? (
        <ColorSwatch label="Color" value={effect.fill.color}
          onChange={(color) => patch({ fill: { type: 'color', color } })} />
      ) : effect.fill.type === 'gradient' ? (
        <LayerStyleGradientEditor value={effect.fill.gradient}
          onChange={(gradient) => gradientFill && patch({ fill: { ...gradientFill, gradient } })} />
      ) : (
        <div className="lighttable-style-notice">
          Pattern Stroke is preserved but remains inactive until its asset is
          resolved by the document registry.
        </div>
      )}
      <NumberSlider label="Opacity" value={effect.opacity * 100} min={0} max={100}
        suffix="%" resetValue={100} onChange={(opacity) => patch({ opacity: opacity / 100 })} />
    </div>
    <PanelSection label="Advanced" variant="disclosure" keepMounted contentClassName="lighttable-property-stack">
      <SelectField label="Blend mode" value={effect.blendMode}
        options={BLEND_MODES.map((mode) => ({ value: mode.id, label: mode.label }))}
        onChange={(blendMode) => patch({ blendMode: blendMode as BlendMode })} />
      {gradientFill ? <>
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
      </> : null}
      <ToggleField label="Overprint" checked={effect.overprint}
        onChange={(overprint) => patch({ overprint })} />
    </PanelSection>
  </>;
};

const EffectControls: React.FC<{
  effect: LayerStyleInstance;
  patch: (patch: Partial<LayerStyleInstance>) => void;
}> = ({ effect, patch }) => {
  const common = <CommonControls effect={effect} patch={patch} />;
  switch (effect.kind) {
    case 'color-overlay':
      return <>{common}<div className="lighttable-style-section"><h4>Color</h4>
        <ColorSwatch label="Color" value={effect.color} onChange={(color) => patch({ color })} />
      </div></>;
    case 'drop-shadow':
    case 'inner-shadow':
      return <ShadowControls effect={effect} patch={patch} />;
    case 'outer-glow':
    case 'inner-glow':
      return <GlowControls effect={effect} patch={patch} />;
    case 'stroke':
      return <StrokeControls effect={effect} patch={patch} />;
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
          <ColorSwatch label="Color" value={effect.color} onChange={(color) => patch({ color })} />
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
            resetValue={120} onChange={(angle) => patch({ angle, useGlobalLight: false })} />
          <NumberSlider label="Altitude" value={effect.altitude} min={0} max={90} suffix="°"
            resetValue={30} onChange={(altitude) => patch({ altitude })} />
          <ColorSwatch label="Highlight" value={effect.highlightColor}
            onChange={(highlightColor) => patch({ highlightColor })} />
          <NumberSlider label="Highlight opacity" value={effect.highlightOpacity * 100}
            min={0} max={100} suffix="%" resetValue={75}
            onChange={(highlightOpacity) => patch({ highlightOpacity: highlightOpacity / 100 })} />
          <ColorSwatch label="Shadow" value={effect.shadowColor}
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
  previewIntervalMs = LAYER_STYLE_PREVIEW_INTERVAL_MS,
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
  const [expandedIds, setExpandedIds] = React.useState<Set<LayerStyleId>>(() => {
    const first = initialEffectId ?? initialStack.effects.at(-1)?.id;
    return new Set(first ? [first] : []);
  });
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
    }, previewIntervalMs);
  }, [previewIntervalMs, publishLatestPreview]);

  React.useEffect(() => {
    if (initialEffectId && draft.effects.some((effect) => effect.id === initialEffectId)) {
      setSelectedId(initialEffectId);
      setExpandedIds((current) => new Set(current).add(initialEffectId));
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
    patchEffect(selectedId, patch);
  };

  const patchEffect = (effectId: LayerStyleId, patch: Partial<LayerStyleInstance>) => {
    updateDraft((current) => ({
      ...current,
      effects: current.effects.map((effect) =>
        effect.id === effectId ? { ...effect, ...patch } as LayerStyleInstance : effect
      ),
      revision: current.revision + 1
    }));
  };

  const resetEffect = (effectId: LayerStyleId) => {
    updateDraft((current) => ({
      ...current,
      effects: current.effects.map((effect) => {
        if (effect.id !== effectId) return effect;
        return {
          ...createDefaultLayerStyle(effect.kind),
          id: effect.id,
          name: effect.name,
          enabled: effect.enabled
        } as LayerStyleInstance;
      }),
      revision: current.revision + 1
    }));
  };

  const resetAllEffects = () => {
    updateDraft((current) => ({
      ...current,
      scale: 1,
      effects: current.effects.map((effect) => ({
        ...createDefaultLayerStyle(effect.kind),
        id: effect.id,
        name: effect.name,
        enabled: effect.enabled
      } as LayerStyleInstance)),
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
    setExpandedIds((current) => new Set(current).add(effect.id));
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
    setExpandedIds((current) => {
      const next = new Set(current);
      next.delete(effectId);
      return next;
    });
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

  if (mode === 'panel') {
    return (
      <div
        className="lighttable-style-editor lighttable-style-editor--panel lighttable-style-editor--groups"
        role="region"
        aria-label="Layer Style"
      >
        <section className="lighttable-group lighttable-master-group">
          <PanelSectionHeader label="All" actions={<>
              <IconButton variant="quiet" type="button" onClick={resetAllEffects} aria-label="Reset all layer effects" title="Reset all layer effects" icon={<MaskIcon src={lightTableIcon('settings_reset.png')} />} />
              <SwitchControl
                checked={draft.enabled}
                onCheckedChange={(enabled) => updateDraft((current) => ({
                  ...current,
                  enabled,
                  revision: current.revision + 1
                }))}
                label={`${draft.enabled ? 'Disable' : 'Enable'} all layer effects`}
              />
            </>} />
        </section>
        <div className="lighttable-panel__controls lighttable-style-editor__groups">
          {[...draft.effects].reverse().map((effect) => (
            <EffectPanel
              key={effect.id}
              label={effect.name}
              expanded={expandedIds.has(effect.id)}
              enabled={effect.enabled}
              resetModifierActive={false}
              onExpandedChange={(expanded) => setExpandedIds((current) => {
                const next = new Set(current);
                if (expanded) next.add(effect.id);
                else next.delete(effect.id);
                return next;
              })}
              onEnabledChange={(enabled) => patchEffect(effect.id, { enabled })}
              onReset={() => resetEffect(effect.id)}
              onRemove={() => removeEffect(effect.id)}
            >
              <EffectControls
                effect={effect}
                patch={(patch) => patchEffect(effect.id, patch)}
              />
            </EffectPanel>
          ))}
          <div className="lighttable-style-editor__add">
            <Select value={newKind} onValueChange={(nextValue) => setNewKind(nextValue as LayerStyleKind)}>
              {STYLE_KINDS.map((kind) => <option key={kind} value={kind}>{layerStyleKindLabels[kind]}</option>)}
            </Select>
            <Button type="button" onClick={addStyle}>Add</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="lighttable-style-editor"
      role="dialog"
      aria-modal="true"
      aria-label="Layer Style"
    >
      <header>
        <div>
          <strong>Layer Style</strong>
          <span>{layerName}</span>
        </div>
        <ButtonBase type="button" onClick={onCancel} aria-label="Close Layer Style editor">×</ButtonBase>
      </header>
      <div className="lighttable-style-editor__body">
        <aside>
          <label className="lighttable-style-stack-toggle">
            <Checkbox tabIndex={0} checked={draft.enabled}
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
                <Checkbox
                  tabIndex={0}
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
                <ButtonBase type="button" onClick={() => setSelectedId(effect.id)}>
                  {effect.name}
                </ButtonBase>
                <ButtonBase
                  type="button"
                  className="lighttable-style-editor__effect-remove"
                  aria-label={`Remove ${effect.name}`}
                  title={`Remove ${effect.name}`}
                  onClick={() => removeEffect(effect.id)}
                >×</ButtonBase>
              </div>
            ))}
          </div>
          <div className="lighttable-style-editor__add">
            <Select value={newKind} onValueChange={(nextValue) => setNewKind(nextValue as LayerStyleKind)}>
              {STYLE_KINDS.map((kind) => <option key={kind} value={kind}>{layerStyleKindLabels[kind]}</option>)}
            </Select>
            <Button tabIndex={0} type="button" onClick={addStyle}>Add</Button>
          </div>
        </aside>
        <main>
          {selected ? (
            <>
              <div className="lighttable-style-editor__effect-heading">
                <h3>{selected.name}</h3>
                <div>
                  <ButtonBase type="button" onClick={() => moveSelected(1)}
                    disabled={draft.effects.at(-1)?.id === selectedId}
                    title="Move effect up">↑</ButtonBase>
                  <ButtonBase type="button" onClick={() => moveSelected(-1)}
                    disabled={draft.effects[0]?.id === selectedId}
                    title="Move effect down">↓</ButtonBase>
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
        <Button tabIndex={0} type="button" onClick={onCancel}>Cancel</Button>
        <Button tabIndex={0} type="button" onClick={onCommit}>OK</Button>
      </footer>
    </div>
  );
};
