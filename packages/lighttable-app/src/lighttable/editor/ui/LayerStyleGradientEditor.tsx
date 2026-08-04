import React from 'react';
import type {
  LayerStyleColor,
  LayerStyleGradient,
  LayerStyleGradientStop,
  LayerStyleOpacityStop
} from '../styles/layerStyleTypes';

const MAX_STOPS = 8;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const stopId = () => `stop-${crypto.randomUUID()}`;
const channelHex = (value: number) =>
  Math.round(clamp01(value) * 255).toString(16).padStart(2, '0');
const colorHex = (color: LayerStyleColor) =>
  `#${channelHex(color.r)}${channelHex(color.g)}${channelHex(color.b)}`;
const parseHex = (value: string, alpha = 1): LayerStyleColor => ({
  r: Number.parseInt(value.slice(1, 3), 16) / 255,
  g: Number.parseInt(value.slice(3, 5), 16) / 255,
  b: Number.parseInt(value.slice(5, 7), 16) / 255,
  a: alpha
});

const sampleColor = (stops: LayerStyleGradientStop[], position: number) => {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const upperIndex = sorted.findIndex((stop) => stop.position >= position);
  if (upperIndex <= 0) return sorted[0]?.color ?? { r: 0, g: 0, b: 0, a: 1 };
  if (upperIndex < 0) return sorted.at(-1)?.color ?? { r: 1, g: 1, b: 1, a: 1 };
  const lower = sorted[upperIndex - 1];
  const upper = sorted[upperIndex];
  const amount = (position - lower.position) / Math.max(1e-6, upper.position - lower.position);
  return {
    r: lower.color.r + (upper.color.r - lower.color.r) * amount,
    g: lower.color.g + (upper.color.g - lower.color.g) * amount,
    b: lower.color.b + (upper.color.b - lower.color.b) * amount,
    a: lower.color.a + (upper.color.a - lower.color.a) * amount
  };
};

const sampleOpacity = (stops: LayerStyleOpacityStop[], position: number) => {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const upperIndex = sorted.findIndex((stop) => stop.position >= position);
  if (upperIndex <= 0) return sorted[0]?.opacity ?? 1;
  if (upperIndex < 0) return sorted.at(-1)?.opacity ?? 1;
  const lower = sorted[upperIndex - 1];
  const upper = sorted[upperIndex];
  const amount = (position - lower.position) / Math.max(1e-6, upper.position - lower.position);
  return lower.opacity + (upper.opacity - lower.opacity) * amount;
};

export const GradientAssetEditor: React.FC<{
  value: LayerStyleGradient;
  onChange: (value: LayerStyleGradient) => void;
}> = ({ value, onChange }) => {
  const colorStops = [...value.colorStops].sort((a, b) => a.position - b.position);
  const opacityStops = [...value.opacityStops].sort((a, b) => a.position - b.position);
  const [selectedColorId, setSelectedColorId] = React.useState<string | null>(
    colorStops[0]?.id ?? null
  );
  const [selectedOpacityId, setSelectedOpacityId] = React.useState<string | null>(
    opacityStops[0]?.id ?? null
  );
  const selectedColor = colorStops.find((stop) => stop.id === selectedColorId) ?? colorStops[0];
  const selectedOpacity = opacityStops.find((stop) => stop.id === selectedOpacityId) ?? opacityStops[0];
  const preview = colorStops.length > 0
    ? `linear-gradient(90deg, ${colorStops.map((stop) =>
      `${colorHex(stop.color)} ${(stop.position * 100).toFixed(2)}%`
    ).join(', ')})`
    : '#000';

  const publish = (patch: Partial<LayerStyleGradient>) => onChange({ ...value, ...patch });
  const updateColor = (id: string, patch: Partial<LayerStyleGradientStop>) => publish({
    colorStops: value.colorStops.map((stop) => stop.id === id ? { ...stop, ...patch } : stop)
  });
  const updateOpacity = (id: string, patch: Partial<LayerStyleOpacityStop>) => publish({
    opacityStops: value.opacityStops.map((stop) => stop.id === id ? { ...stop, ...patch } : stop)
  });

  const addColor = () => {
    if (value.colorStops.length >= MAX_STOPS) return;
    const position = 0.5;
    const stop = {
      id: stopId(),
      position,
      midpoint: 0.5,
      color: sampleColor(value.colorStops, position)
    };
    publish({ colorStops: [...value.colorStops, stop] });
    setSelectedColorId(stop.id);
  };
  const addOpacity = () => {
    if (value.opacityStops.length >= MAX_STOPS) return;
    const position = 0.5;
    const stop = {
      id: stopId(),
      position,
      midpoint: 0.5,
      opacity: sampleOpacity(value.opacityStops, position)
    };
    publish({ opacityStops: [...value.opacityStops, stop] });
    setSelectedOpacityId(stop.id);
  };

  return (
    <div className="lighttable-style-gradient">
      <div className="lighttable-style-gradient__preview" style={{ background: preview }}>
        {opacityStops.map((stop) => (
          <button
            type="button"
            key={stop.id}
            className={`lighttable-style-gradient__stop lighttable-style-gradient__stop--opacity${
              stop.id === selectedOpacity?.id ? ' lighttable-style-gradient__stop--active' : ''
            }`}
            style={{ left: `${stop.position * 100}%`, opacity: Math.max(0.22, stop.opacity) }}
            onClick={() => setSelectedOpacityId(stop.id)}
            aria-label={`Opacity stop ${Math.round(stop.position * 100)}%`}
          />
        ))}
        {colorStops.map((stop) => (
          <button
            type="button"
            key={stop.id}
            className={`lighttable-style-gradient__stop lighttable-style-gradient__stop--color${
              stop.id === selectedColor?.id ? ' lighttable-style-gradient__stop--active' : ''
            }`}
            style={{ left: `${stop.position * 100}%`, background: colorHex(stop.color) }}
            onClick={() => setSelectedColorId(stop.id)}
            aria-label={`Color stop ${Math.round(stop.position * 100)}%`}
          />
        ))}
      </div>

      <div className="lighttable-style-gradient__toolbar">
        <strong>Color stops</strong>
        <button type="button" onClick={addColor} disabled={colorStops.length >= MAX_STOPS}>Add</button>
        <button type="button" disabled={!selectedColor || colorStops.length <= 2}
          onClick={() => {
            if (!selectedColor || colorStops.length <= 2) return;
            publish({ colorStops: value.colorStops.filter((stop) => stop.id !== selectedColor.id) });
            setSelectedColorId(colorStops.find((stop) => stop.id !== selectedColor.id)?.id ?? null);
          }}>Remove</button>
      </div>
      {selectedColor ? (
        <div className="lighttable-style-gradient__controls">
          <label><span>Color</span><input type="color" value={colorHex(selectedColor.color)}
            onChange={(event) => updateColor(selectedColor.id, {
              color: parseHex(event.currentTarget.value, selectedColor.color.a)
            })} /></label>
          <label><span>Location</span><input type="range" min="0" max="100" step="0.1"
            value={selectedColor.position * 100}
            onChange={(event) => updateColor(selectedColor.id, {
              position: Number(event.currentTarget.value) / 100
            })} /><output>{Math.round(selectedColor.position * 100)}%</output></label>
          <label><span>Midpoint</span><input type="range" min="5" max="95" step="1"
            value={selectedColor.midpoint * 100}
            onChange={(event) => updateColor(selectedColor.id, {
              midpoint: Number(event.currentTarget.value) / 100
            })} /><output>{Math.round(selectedColor.midpoint * 100)}%</output></label>
        </div>
      ) : null}

      <div className="lighttable-style-gradient__toolbar">
        <strong>Opacity stops</strong>
        <button type="button" onClick={addOpacity} disabled={opacityStops.length >= MAX_STOPS}>Add</button>
        <button type="button" disabled={!selectedOpacity || opacityStops.length <= 2}
          onClick={() => {
            if (!selectedOpacity || opacityStops.length <= 2) return;
            publish({ opacityStops: value.opacityStops.filter((stop) => stop.id !== selectedOpacity.id) });
            setSelectedOpacityId(opacityStops.find((stop) => stop.id !== selectedOpacity.id)?.id ?? null);
          }}>Remove</button>
      </div>
      {selectedOpacity ? (
        <div className="lighttable-style-gradient__controls">
          <label><span>Opacity</span><input type="range" min="0" max="100" step="1"
            value={selectedOpacity.opacity * 100}
            onChange={(event) => updateOpacity(selectedOpacity.id, {
              opacity: Number(event.currentTarget.value) / 100
            })} /><output>{Math.round(selectedOpacity.opacity * 100)}%</output></label>
          <label><span>Location</span><input type="range" min="0" max="100" step="0.1"
            value={selectedOpacity.position * 100}
            onChange={(event) => updateOpacity(selectedOpacity.id, {
              position: Number(event.currentTarget.value) / 100
            })} /><output>{Math.round(selectedOpacity.position * 100)}%</output></label>
          <label><span>Midpoint</span><input type="range" min="5" max="95" step="1"
            value={selectedOpacity.midpoint * 100}
            onChange={(event) => updateOpacity(selectedOpacity.id, {
              midpoint: Number(event.currentTarget.value) / 100
            })} /><output>{Math.round(selectedOpacity.midpoint * 100)}%</output></label>
        </div>
      ) : null}
    </div>
  );
};

/** Compatibility name retained for Layer Style callers. */
export const LayerStyleGradientEditor = GradientAssetEditor;
