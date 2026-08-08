import React from 'react';
import type {
  LayerStyleColor,
  LayerStyleGradient,
  LayerStyleGradientStop,
  LayerStyleOpacityStop
} from '../styles/layerStyleTypes';
import { ActionButton } from '../../../ui/ActionButton';
import { PanelColorSwatch, PanelNumberSlider } from './PanelControls';

const MAX_STOPS = 8;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const stopId = () => `stop-${crypto.randomUUID()}`;
const channelHex = (value: number) =>
  Math.round(clamp01(value) * 255).toString(16).padStart(2, '0');
const colorHex = (color: LayerStyleColor) =>
  `#${channelHex(color.r)}${channelHex(color.g)}${channelHex(color.b)}`;
export const gradientStopPosition = (clientX: number, left: number, width: number) =>
  clamp01((clientX - left) / Math.max(1, width));

export const removableGradientStops = <T extends { id: string }>(
  stops: T[],
  id: string
) => stops.length > 2 ? stops.filter((stop) => stop.id !== id) : stops;

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
  initialColorStop?: 'first' | 'last';
}> = ({ value, onChange, initialColorStop = 'first' }) => {
  const colorStops = [...value.colorStops].sort((a, b) => a.position - b.position);
  const opacityStops = [...value.opacityStops].sort((a, b) => a.position - b.position);
  const [selectedColorId, setSelectedColorId] = React.useState<string | null>(
    (initialColorStop === 'last' ? colorStops.at(-1) : colorStops[0])?.id ?? null
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

  const addColor = (position = 0.5) => {
    if (value.colorStops.length >= MAX_STOPS) return;
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
  const removeColor = (id: string) => {
    const colorStops = removableGradientStops(value.colorStops, id);
    if (colorStops === value.colorStops) return;
    publish({ colorStops });
    setSelectedColorId(colorStops[0]?.id ?? null);
  };
  const removeOpacity = (id: string) => {
    const opacityStops = removableGradientStops(value.opacityStops, id);
    if (opacityStops === value.opacityStops) return;
    publish({ opacityStops });
    setSelectedOpacityId(opacityStops[0]?.id ?? null);
  };
  const pointerPosition = (event: React.PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    return bounds ? gradientStopPosition(event.clientX, bounds.left, bounds.width) : 0;
  };
  const draggableStopProps = (
    id: string,
    update: (id: string, patch: { position: number }) => void,
    select: (id: string) => void,
    remove: (id: string) => void,
    removable: boolean
  ) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      select(id);
      event.currentTarget.setPointerCapture(event.pointerId);
      update(id, { position: pointerPosition(event) });
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      update(id, { position: pointerPosition(event) });
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (removable) remove(id);
    },
    onDoubleClick: (event: React.MouseEvent<HTMLButtonElement>) => event.stopPropagation(),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (removable && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        remove(id);
      }
    }
  });

  return (
    <div className="lighttable-style-gradient">
      <div
        className="lighttable-style-gradient__preview"
        style={{ background: preview }}
        title="Double-click to add a color stop"
        onDoubleClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          addColor(gradientStopPosition(event.clientX, bounds.left, bounds.width));
        }}
      >
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
            title="Drag to move · Right-click to delete"
            {...draggableStopProps(
              stop.id,
              updateOpacity,
              setSelectedOpacityId,
              removeOpacity,
              opacityStops.length > 2
            )}
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
            title="Drag to move · Right-click to delete"
            {...draggableStopProps(
              stop.id,
              updateColor,
              setSelectedColorId,
              removeColor,
              colorStops.length > 2
            )}
          />
        ))}
      </div>

      <div className="lighttable-style-gradient__toolbar">
        <strong>Color stops</strong>
        <ActionButton size="compact" onClick={() => addColor()}
          disabled={colorStops.length >= MAX_STOPS}>Add</ActionButton>
        <ActionButton size="compact" disabled={!selectedColor || colorStops.length <= 2}
          onClick={() => {
            if (!selectedColor || colorStops.length <= 2) return;
            removeColor(selectedColor.id);
          }}>Remove</ActionButton>
      </div>
      {selectedColor ? (
        <div className="lighttable-style-gradient__controls">
          <PanelColorSwatch label="Color" value={selectedColor.color}
            onChange={(color) => updateColor(selectedColor.id, { color })} />
          <PanelNumberSlider label="Location" value={selectedColor.position * 100}
            min={0} max={100} step={0.1} suffix="%" resetValue={0}
            onChange={(position) => updateColor(selectedColor.id, { position: position / 100 })} />
          <PanelNumberSlider label="Midpoint" value={selectedColor.midpoint * 100}
            min={5} max={95} suffix="%" resetValue={50}
            onChange={(midpoint) => updateColor(selectedColor.id, { midpoint: midpoint / 100 })} />
        </div>
      ) : null}

      <div className="lighttable-style-gradient__toolbar">
        <strong>Opacity stops</strong>
        <ActionButton size="compact" onClick={addOpacity}
          disabled={opacityStops.length >= MAX_STOPS}>Add</ActionButton>
        <ActionButton size="compact" disabled={!selectedOpacity || opacityStops.length <= 2}
          onClick={() => {
            if (!selectedOpacity || opacityStops.length <= 2) return;
            removeOpacity(selectedOpacity.id);
          }}>Remove</ActionButton>
      </div>
      {selectedOpacity ? (
        <div className="lighttable-style-gradient__controls">
          <PanelNumberSlider label="Opacity" value={selectedOpacity.opacity * 100}
            min={0} max={100} suffix="%" resetValue={100}
            onChange={(opacity) => updateOpacity(selectedOpacity.id, { opacity: opacity / 100 })} />
          <PanelNumberSlider label="Location" value={selectedOpacity.position * 100}
            min={0} max={100} step={0.1} suffix="%" resetValue={0}
            onChange={(position) => updateOpacity(selectedOpacity.id, { position: position / 100 })} />
          <PanelNumberSlider label="Midpoint" value={selectedOpacity.midpoint * 100}
            min={5} max={95} suffix="%" resetValue={50}
            onChange={(midpoint) => updateOpacity(selectedOpacity.id, { midpoint: midpoint / 100 })} />
        </div>
      ) : null}
      <small className="lighttable-style-gradient__hint">
        Drag stops to position them · Double-click the ramp to add · Right-click a stop to delete
      </small>
    </div>
  );
};

/** Compatibility name retained for Layer Style callers. */
export const LayerStyleGradientEditor = GradientAssetEditor;
