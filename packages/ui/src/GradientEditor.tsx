import React from 'react';
import { SliderField } from './Slider';
import { useSliderInteraction } from './useSliderInteraction';
import { clamp01, stopId, colorHex, sampleColor, sampleOpacity, gradientStopPosition, gradientMidpointPosition,
  gradientMidpointValue, removableGradientStops, gradientPreview } from './gradientUtils';

export interface GradientColor { r: number; g: number; b: number; a: number }
export interface GradientColorStop { id: string; position: number; midpoint: number; color: GradientColor }
export interface GradientOpacityStop { id: string; position: number; midpoint: number; opacity: number }
export interface GradientValue { colorStops: GradientColorStop[]; opacityStops: GradientOpacityStop[] }
export interface GradientColorFieldProps {
  value: GradientColor;
  onChange: (value: GradientColor) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  onInteractionCancel: () => void;
}
export interface GradientEditorProps {
  value: GradientValue;
  onChange: (value: GradientValue) => void;
  initialColorStop?: 'first' | 'last';
  maxStops?: number;
  publishIntervalMs?: number | 'animation-frame';
  tabIndex?: number;
  renderColorField?: (props: GradientColorFieldProps) => React.ReactNode;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  onInteractionCancel?: () => void;
}

const DEFAULT_HINT = 'Hover over a control for instructions.';

export const GradientEditor = ({
  value, onChange, initialColorStop = 'first', maxStops = 8, publishIntervalMs = 33, tabIndex = -1, renderColorField,
  onInteractionStart, onInteractionEnd, onInteractionCancel
}: GradientEditorProps) => {
  const interaction = useSliderInteraction(value, {
    onChange, onInteractionStart, onInteractionEnd, onInteractionCancel, publishIntervalMs
  });
  const presentedValue = interaction.display;
  const colorStops = [...presentedValue.colorStops].sort((a, b) => a.position - b.position);
  const opacityStops = [...presentedValue.opacityStops].sort((a, b) => a.position - b.position);
  const [selectedColorId, setSelectedColorId] = React.useState<string | null>(
    (initialColorStop === 'last' ? colorStops.at(-1) : colorStops[0])?.id ?? null
  );
  const [selectedOpacityId, setSelectedOpacityId] = React.useState<string | null>(
    opacityStops[0]?.id ?? null
  );
  const [hint, setHint] = React.useState(DEFAULT_HINT);
  const selectedColor = colorStops.find((stop) => stop.id === selectedColorId) ?? colorStops[0];
  const selectedOpacity = opacityStops.find((stop) => stop.id === selectedOpacityId) ?? opacityStops[0];
  const preview = gradientPreview(presentedValue);


  const beginInteraction = interaction.begin;
  const endInteraction = interaction.end;
  const cancelInteraction = interaction.cancel;
  const publish = (patch: Partial<GradientValue>) => {
    const discrete = !interaction.active.current;
    if (discrete) beginInteraction();
    interaction.update({ ...interaction.latest.current, ...patch });
    if (discrete) endInteraction();
  };
  const updateColor = (id: string, patch: Partial<GradientColorStop>) => publish({
    colorStops: interaction.latest.current.colorStops.map((stop) => stop.id === id ? { ...stop, ...patch } : stop)
  });
  const updateOpacity = (id: string, patch: Partial<GradientOpacityStop>) => publish({
    opacityStops: interaction.latest.current.opacityStops.map((stop) => stop.id === id ? { ...stop, ...patch } : stop)
  });

  const addColor = (position = 0.5) => {
    const current = interaction.latest.current;
    if (current.colorStops.length >= maxStops) return;
    const stop = {
      id: stopId(),
      position,
      midpoint: 0.5,
      color: sampleColor(current.colorStops, position)
    };
    publish({ colorStops: [...current.colorStops, stop] });
    setSelectedColorId(stop.id);
  };
  const addOpacity = (position = 0.5) => {
    const current = interaction.latest.current;
    if (current.opacityStops.length >= maxStops) return;
    const stop = {
      id: stopId(),
      position,
      midpoint: 0.5,
      opacity: sampleOpacity(current.opacityStops, position)
    };
    publish({ opacityStops: [...current.opacityStops, stop] });
    setSelectedOpacityId(stop.id);
  };
  const removeColor = (id: string) => {
    const current = interaction.latest.current;
    const colorStops = removableGradientStops(current.colorStops, id);
    if (colorStops === current.colorStops) return;
    publish({ colorStops });
    setSelectedColorId(colorStops[0]?.id ?? null);
  };
  const removeOpacity = (id: string) => {
    const current = interaction.latest.current;
    const opacityStops = removableGradientStops(current.opacityStops, id);
    if (opacityStops === current.opacityStops) return;
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
      event.currentTarget.focus({ preventScroll: true });
      beginInteraction();
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
        update(id, { position: pointerPosition(event) });
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      endInteraction();
    },
    onPointerCancel: cancelInteraction,
    onLostPointerCapture: () => {
      if (interaction.active.current) cancelInteraction();
    },
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (removable) {
        beginInteraction();
        remove(id);
        endInteraction();
      }
    },
    onKeyUp: endInteraction,
    onBlur: endInteraction,
    onDoubleClick: (event: React.MouseEvent<HTMLButtonElement>) => event.stopPropagation(),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); beginInteraction();
        const stops = update === updateColor ? interaction.latest.current.colorStops : interaction.latest.current.opacityStops;
        const stop = stops.find(stop => stop.id === id);
        if (stop) update(id, { position: clamp01(stop.position + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 0.1 : 0.01)) });
        return;
      }
      if (removable && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        beginInteraction();
        remove(id);
        endInteraction();
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
        event.currentTarget.focus({ preventScroll: true });
        beginInteraction();
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event);
      },
      onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event);
      },
      onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          move(event);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        endInteraction();
      },
      onPointerCancel: cancelInteraction,
      onLostPointerCapture: () => {
        if (interaction.active.current) cancelInteraction();
      },
      onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault(); beginInteraction();
        const stops = update === updateColor ? interaction.latest.current.colorStops : interaction.latest.current.opacityStops;
        const stop = stops.find(stop => stop.id === leftId);
        if (stop) update(leftId, { midpoint: Math.max(0.05, Math.min(0.95,
          stop.midpoint + (event.key === 'ArrowRight' ? 0.01 : -0.01))) });
      },
      onKeyUp: endInteraction,
      onBlur: endInteraction,
      onDoubleClick: (event: React.MouseEvent<HTMLButtonElement>) => event.stopPropagation()
    };
  };

  return (
    <div className="ui-gradient-editor" data-ui-component="gradient-editor" data-suite-control="gradient-editor"
      onMouseLeave={() => setHint(DEFAULT_HINT)}>
      {selectedOpacity ? (
        <div className="ui-gradient-editor__opacity-control"
          onMouseEnter={() => setHint('Adjust the opacity of the selected opacity stop.')}
          onFocus={() => setHint('Adjust the opacity of the selected opacity stop.')}>
          <SliderField label="Opacity" ariaLabel="Gradient stop opacity" layout="inline"
            value={selectedOpacity.opacity * 100} min={0} max={100} resetValue={100}
            format={value => `${Math.round(value)}%`} tabIndex={tabIndex}
            transparency trackBackground={`linear-gradient(to right, transparent, ${colorHex(sampleColor(presentedValue.colorStops, selectedOpacity.position))})`}
            onChange={opacity => updateOpacity(selectedOpacity.id, { opacity: opacity / 100 })}
            onInteractionStart={beginInteraction} onInteractionEnd={endInteraction}
            onInteractionCancel={cancelInteraction} />
        </div>
      ) : null}
      <div className="ui-gradient-editor__track">
        <button tabIndex={tabIndex} type="button"
          className="ui-gradient-editor__hit-region ui-gradient-editor__hit-region--opacity"
          aria-label="Add opacity stop"
          onMouseEnter={() => setHint('Click above the gradient to add an opacity stop.')}
          onFocus={() => setHint('Press Enter to add an opacity stop in the center.')}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault(); addOpacity();
          }}
          onClick={(event) => {
            beginInteraction();
            const bounds = event.currentTarget.getBoundingClientRect();
            addOpacity(event.detail === 0 ? 0.5
              : gradientStopPosition(event.clientX, bounds.left, bounds.width));
            endInteraction();
          }} />
        <div className="ui-gradient-editor__preview" style={{ '--ui-gradient-ramp': preview } as React.CSSProperties}>
        {opacityStops.slice(0, -1).map((stop, index) => {
          const next = opacityStops[index + 1]!;
          const position = gradientMidpointPosition(stop.position, next.position, stop.midpoint);
          return <button tabIndex={tabIndex} type="button" key={`opacity-midpoint-${stop.id}`}
            className="ui-gradient-editor__midpoint ui-gradient-editor__midpoint--opacity"
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
          return <button tabIndex={tabIndex} type="button" key={`color-midpoint-${stop.id}`}
            className="ui-gradient-editor__midpoint ui-gradient-editor__midpoint--color"
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
          <button tabIndex={tabIndex}
            type="button"
            key={stop.id}
            className={`ui-gradient-editor__stop ui-gradient-editor__stop--opacity${
              stop.id === selectedOpacity?.id ? ' ui-gradient-editor__stop--active' : ''
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
          <button tabIndex={tabIndex}
            type="button"
            key={stop.id}
            className={`ui-gradient-editor__stop ui-gradient-editor__stop--color${
              stop.id === selectedColor?.id ? ' ui-gradient-editor__stop--active' : ''
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
        <button tabIndex={tabIndex} type="button"
          className="ui-gradient-editor__hit-region ui-gradient-editor__hit-region--color"
          aria-label="Add color stop"
          onMouseEnter={() => setHint('Click below the gradient to add a color stop.')}
          onFocus={() => setHint('Press Enter to add a color stop in the center.')}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault(); addColor();
          }}
          onClick={(event) => {
            beginInteraction();
            const bounds = event.currentTarget.getBoundingClientRect();
            addColor(event.detail === 0 ? 0.5
              : gradientStopPosition(event.clientX, bounds.left, bounds.width));
            endInteraction();
          }} />
      </div>

      {selectedColor ? (
        <div className="ui-gradient-editor__color-control"
          onMouseEnter={() => setHint('Choose the color of the selected color stop.')}
          onFocus={() => setHint('Choose the color of the selected color stop.')}>
          {renderColorField ? renderColorField({
            value: selectedColor.color,
            onChange: color => updateColor(selectedColor.id, { color }),
            onInteractionStart: beginInteraction, onInteractionEnd: endInteraction,
            onInteractionCancel: cancelInteraction
          }) : <label className="ui-gradient-editor__color-field">Color
            <input type="color" aria-label="Gradient stop color" tabIndex={tabIndex} value={colorHex(selectedColor.color)}
              onFocus={beginInteraction} onBlur={endInteraction}
              onChange={event => {
                beginInteraction();
                const hex = event.currentTarget.value;
                updateColor(selectedColor.id, { color: {
                  r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255,
                  b: parseInt(hex.slice(5, 7), 16) / 255, a: selectedColor.color.a
                } });
              }} />
          </label>}
        </div>
      ) : null}

      <small className="ui-gradient-editor__hint" aria-live="polite">
        {hint}
      </small>
    </div>
  );
};
