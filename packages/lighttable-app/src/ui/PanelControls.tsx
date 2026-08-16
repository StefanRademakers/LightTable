import React from 'react';
import { AdjustmentSlider } from './AdjustmentSlider';
import { ColorSwatchField } from './ColorSwatchField';
import { ActionButton } from './ActionButton';
import { FormSelect } from './FormSelect';

export interface PanelColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const channelHex = (value: number) =>
  Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0');

export const panelColorHex = (color: PanelColor) =>
  `#${channelHex(color.r)}${channelHex(color.g)}${channelHex(color.b)}`;

export const parsePanelHexColor = <T extends PanelColor>(value: string, alpha: number): T => ({
  r: Number.parseInt(value.slice(1, 3), 16) / 255,
  g: Number.parseInt(value.slice(3, 5), 16) / 255,
  b: Number.parseInt(value.slice(5, 7), 16) / 255,
  a: alpha
} as T);

export const PanelSelectField: React.FC<{
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  labelWidth?: string;
  onChange: (value: string) => void;
}> = ({ label, value, options, labelWidth, onChange }) => (
  <label className="lighttable-style-field" data-suite-control="panel-select"
    style={labelWidth ? { '--lt-property-label-width': labelWidth } as React.CSSProperties : undefined}>
    <span>{label}</span>
    <FormSelect value={value} onChange={(event) => onChange(event.currentTarget.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </FormSelect>
  </label>
);

const acceptedFile = (file: File, accept: string) => {
  const rules = accept.split(',').map((rule) => rule.trim().toLowerCase()).filter(Boolean);
  if (!rules.length) return true;
  const name = file.name.toLowerCase();
  const mediaType = file.type.toLowerCase();
  return rules.some((rule) => rule.startsWith('.') ? name.endsWith(rule) : mediaType === rule);
};

export const PanelFileField: React.FC<{
  label: string;
  buttonLabel: string;
  accept: string;
  disabled?: boolean;
  title?: string;
  onFile: (file: File) => void | Promise<void>;
  onRejected?: () => void;
}> = ({ label, buttonLabel, accept, disabled = false, title, onFile, onRejected }) => {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const publish = (files: FileList | null) => {
    const file = Array.from(files ?? []).find((candidate) => acceptedFile(candidate, accept));
    if (file) void onFile(file);
    else if (files?.length) onRejected?.();
  };
  return (
    <div className="lighttable-style-field lighttable-file-field" title={title}
      data-suite-control="panel-file"
      onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        publish(event.dataTransfer.files);
      }}>
      <span>{label}</span>
      <ActionButton size="control" disabled={disabled} onClick={() => inputRef.current?.click()}>
        {buttonLabel}
      </ActionButton>
      <input ref={inputRef} type="file" accept={accept} hidden onChange={(event) => {
        publish(event.currentTarget.files);
        event.currentTarget.value = '';
      }} />
    </div>
  );
};

export const PanelCheckboxField: React.FC<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <label className="lighttable-style-toggle" data-suite-control="panel-checkbox">
    <input type="checkbox" checked={checked}
      onChange={(event) => onChange(event.currentTarget.checked)} />
    <span>{label}</span>
  </label>
);

export const PanelColorSwatch = <T extends PanelColor>({
  label, value, inline = false, onChange
}: {
  label: string;
  value: T;
  inline?: boolean;
  onChange: (color: T) => void;
}) => {
  const swatch = (
    <ColorSwatchField value={panelColorHex(value)} ariaLabel={label}
      onChange={(color) => onChange(parsePanelHexColor<T>(color, value.a))} />
  );
  return inline ? swatch : (
    <div className="lighttable-style-field">
      <span>{label}</span>
      {swatch}
    </div>
  );
};

export const PanelNumberSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  resetValue?: number;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, suffix = '', resetValue = 0, onChange }) => (
  <AdjustmentSlider label={label} value={value} min={min} max={max} step={step}
    resetValue={resetValue}
    format={(current) => `${step < 1 ? current.toFixed(2) : Math.round(current)}${suffix}`}
    onChange={onChange} onReset={() => onChange(resetValue)} />
);

const normalizeAngle = (value: number) => ((value % 360) + 360) % 360;
const ANGLE_PUBLISH_INTERVAL_MS = 33;

export const PanelAngleControl: React.FC<{
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
    if (elapsed >= ANGLE_PUBLISH_INTERVAL_MS) return publishLatestValue();
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
    if (Math.hypot(x, y) >= 1) previewValue(Math.atan2(-y, x) * 180 / Math.PI);
  };

  return <div className="lighttable-style-angle" data-suite-control="panel-angle">
    <span className="lighttable-style-angle__controls">
      <div ref={dialRef} className="lighttable-style-angle__dial" role="slider" tabIndex={0}
        aria-label={label} aria-valuemin={0} aria-valuemax={359}
        aria-valuenow={Math.round(normalized)} aria-valuetext={`${Math.round(normalized)} degrees`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          pointerIdRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (pointerIdRef.current === event.pointerId) updateFromPointer(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => finishPointerInteraction(event.pointerId)}
        onPointerCancel={(event) => finishPointerInteraction(event.pointerId)}
        onLostPointerCapture={(event) => finishPointerInteraction(event.pointerId)}
        onDoubleClick={() => onChange(resetValue)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 1;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault(); onChange(normalizeAngle(normalized - step));
          } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault(); onChange(normalizeAngle(normalized + step));
          } else if (event.key === 'Home') {
            event.preventDefault(); onChange(resetValue);
          }
        }}>
        <span className="lighttable-style-angle__hand"
          style={{ transform: `rotate(${-normalized}deg)` }} aria-hidden="true" />
      </div>
      <span className="lighttable-style-angle__number">
        <input type="number" min={0} max={359} step={1} value={Math.round(normalized)}
          aria-label={`${label} degrees`}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (Number.isFinite(next)) onChange(normalizeAngle(next));
          }} />
        <span>°</span>
      </span>
    </span>
  </div>;
};

export const PanelAdvancedDisclosure: React.FC<React.PropsWithChildren<{
  edge?: 'contained' | 'panel-bleed';
}>> = ({ children, edge = 'contained' }) => (
  <details className={`lighttable-style-advanced lighttable-style-advanced--${edge}`}
    data-suite-control="advanced-disclosure">
    <summary>Advanced</summary>
    <div className="lighttable-style-advanced__content">{children}</div>
  </details>
);
