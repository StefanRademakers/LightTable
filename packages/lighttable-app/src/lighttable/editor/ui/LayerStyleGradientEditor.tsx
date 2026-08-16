import { ButtonBase } from '../../../ui/ButtonBase';
import React from 'react';
import type {
  LayerStyleColor,
  LayerStyleGradient,
  LayerStyleGradientStop,
  LayerStyleOpacityStop
} from '../styles/layerStyleTypes';
import { OpacitySlider } from '../../../ui/OpacitySlider';
import { PanelColorSwatch } from '../../../ui/PanelControls';

const MAX_STOPS = 8;
const DEFAULT_HINT = 'Hover over a control for instructions.';
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const stopId = () => `stop-${crypto.randomUUID()}`;
const channelHex = (value: number) =>
  Math.round(clamp01(value) * 255).toString(16).padStart(2, '0');
const colorHex = (color: LayerStyleColor) =>
  `#${channelHex(color.r)}${channelHex(color.g)}${channelHex(color.b)}`;
export const gradientStopPosition = (clientX: number, left: number, width: number) =>
  clamp01((clientX - left) / Math.max(1, width));

export const gradientMidpointPosition = (
  leftPosition: number,
  rightPosition: number,
  midpoint: number
) => leftPosition + (rightPosition - leftPosition) * clamp01(midpoint);

export const gradientMidpointValue = (
  position: number,
  leftPosition: number,
  rightPosition: number
) => Math.max(0.05, Math.min(0.95,
  (position - leftPosition) / Math.max(1e-6, rightPosition - leftPosition)
));

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
  const [hint, setHint] = React.useState(DEFAULT_HINT);
  const [controlPressed, setControlPressed] = React.useState(false);
  React.useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Control') setControlPressed(true);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') setControlPressed(false);
    };
    const reset = () => setControlPressed(false);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', reset);
    };
  }, []);
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
  const addOpacity = (position = 0.5) => {
    if (value.opacityStops.length >= MAX_STOPS) return;
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
  const draggableMidpointProps = (
    leftId: string,
    leftPosition: number,
    rightPosition: number,
    update: (id: string, patch: { midpoint: number }) => void
  ) => {
    const move = (event: React.PointerEvent<HTMLButtonElement>) => update(leftId, {
      midpoint: gradientMidpointValue(pointerPosition(event), leftPosition, rightPosition)
    });
    return {
      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event);
      },
      onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event);
      },
      onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      },
      onDoubleClick: (event: React.MouseEvent<HTMLButtonElement>) => event.stopPropagation()
    };
  };

  return (
    <div className={`lighttable-style-gradient${controlPressed
      ? ' lighttable-style-gradient--remove-stop' : ''}`}
      onMouseLeave={() => setHint(DEFAULT_HINT)}>
      {selectedOpacity ? (
        <div className="lighttable-style-gradient__opacity-control"
          onMouseEnter={() => setHint('Adjust the opacity of the selected opacity stop.')}
          onFocus={() => setHint('Adjust the opacity of the selected opacity stop.')}>
          <OpacitySlider label="Opacity" ariaLabel="Gradient stop opacity"
            value={selectedOpacity.opacity}
            color={colorHex(sampleColor(value.colorStops, selectedOpacity.position))}
            onChange={(opacity) => updateOpacity(selectedOpacity.id, { opacity })} />
        </div>
      ) : null}
      <div className="lighttable-style-gradient__track">
        <ButtonBase type="button"
          className="lighttable-style-gradient__hit-region lighttable-style-gradient__hit-region--opacity"
          aria-label="Add opacity stop"
          onMouseEnter={() => setHint('Click above the gradient to add an opacity stop.')}
          onFocus={() => setHint('Press Enter to add an opacity stop in the center.')}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            addOpacity(event.detail === 0 ? 0.5
              : gradientStopPosition(event.clientX, bounds.left, bounds.width));
          }} />
        <div className="lighttable-style-gradient__preview" style={{ background: preview }}>
        {opacityStops.slice(0, -1).map((stop, index) => {
          const next = opacityStops[index + 1]!;
          const position = gradientMidpointPosition(stop.position, next.position, stop.midpoint);
          return <ButtonBase type="button" key={`opacity-midpoint-${stop.id}`}
            className="lighttable-style-gradient__midpoint lighttable-style-gradient__midpoint--opacity"
            style={{ left: `${position * 100}%` }}
            aria-label={`Opacity midpoint ${Math.round(stop.midpoint * 100)}%`}
            title={`Opacity midpoint ${Math.round(stop.midpoint * 100)}%`}
            onMouseEnter={() => setHint('Drag to move the opacity midpoint between its stops.')}
            onFocus={() => setHint('Drag to move the opacity midpoint between its stops.')}
            {...draggableMidpointProps(
              stop.id, stop.position, next.position, updateOpacity
            )} />;
        })}
        {colorStops.slice(0, -1).map((stop, index) => {
          const next = colorStops[index + 1]!;
          const position = gradientMidpointPosition(stop.position, next.position, stop.midpoint);
          return <ButtonBase type="button" key={`color-midpoint-${stop.id}`}
            className="lighttable-style-gradient__midpoint lighttable-style-gradient__midpoint--color"
            style={{ left: `${position * 100}%` }}
            aria-label={`Color midpoint ${Math.round(stop.midpoint * 100)}%`}
            title={`Color midpoint ${Math.round(stop.midpoint * 100)}%`}
            onMouseEnter={() => setHint('Drag to move the color midpoint between its stops.')}
            onFocus={() => setHint('Drag to move the color midpoint between its stops.')}
            {...draggableMidpointProps(
              stop.id, stop.position, next.position, updateColor
            )} />;
        })}
        {opacityStops.map((stop) => (
          <ButtonBase
            type="button"
            key={stop.id}
            className={`lighttable-style-gradient__stop lighttable-style-gradient__stop--opacity${
              stop.id === selectedOpacity?.id ? ' lighttable-style-gradient__stop--active' : ''
            }`}
            style={{ left: `${stop.position * 100}%`, opacity: Math.max(0.22, stop.opacity) }}
            onClick={() => setSelectedOpacityId(stop.id)}
            onMouseEnter={() => setHint('Drag this opacity stop to move it · Right-click to delete it.')}
            onFocus={() => setHint('Right-click or press Delete to remove this opacity stop.')}
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
          <ButtonBase
            type="button"
            key={stop.id}
            className={`lighttable-style-gradient__stop lighttable-style-gradient__stop--color${
              stop.id === selectedColor?.id ? ' lighttable-style-gradient__stop--active' : ''
            }`}
            style={{
              left: `${stop.position * 100}%`,
              '--gradient-stop-color': colorHex(stop.color)
            } as React.CSSProperties}
            onClick={() => setSelectedColorId(stop.id)}
            onMouseEnter={() => setHint('Drag this color stop to move it · Right-click to delete it.')}
            onFocus={() => setHint('Right-click or press Delete to remove this color stop.')}
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
        <ButtonBase type="button"
          className="lighttable-style-gradient__hit-region lighttable-style-gradient__hit-region--color"
          aria-label="Add color stop"
          onMouseEnter={() => setHint('Click below the gradient to add a color stop.')}
          onFocus={() => setHint('Press Enter to add a color stop in the center.')}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            addColor(event.detail === 0 ? 0.5
              : gradientStopPosition(event.clientX, bounds.left, bounds.width));
          }} />
      </div>

      {selectedColor ? (
        <div className="lighttable-style-gradient__color-control"
          onMouseEnter={() => setHint('Choose the color of the selected color stop.')}
          onFocus={() => setHint('Choose the color of the selected color stop.')}>
          <PanelColorSwatch label="Color" value={selectedColor.color}
            onChange={(color) => updateColor(selectedColor.id, { color })} />
        </div>
      ) : null}

      <small className="lighttable-style-gradient__hint" aria-live="polite">
        {hint}
      </small>
    </div>
  );
};

/** Compatibility name retained for Layer Style callers. */
export const LayerStyleGradientEditor = GradientAssetEditor;
