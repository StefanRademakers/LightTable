import React, { useEffect, useRef, useState } from 'react';
import type { MixedValue } from '../../application/text/flowTextFormatting';

export interface MixedNumberInputProps {
  readonly label: string;
  readonly value: MixedValue<number>;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
  readonly disabled?: boolean;
  readonly onBegin: () => void;
  readonly onPreview: (value: number) => void;
  readonly onCommit: () => void;
  readonly onCancel: () => void;
}

export const numericIncrement = (
  value: number,
  direction: -1 | 1,
  step: number,
  modifiers: { readonly shiftKey?: boolean; readonly altKey?: boolean }
) => value + direction * step * (modifiers.shiftKey ? 10 : modifiers.altKey ? 0.1 : 1);

export const parseBoundedNumber = (draft: string, min: number, max: number) => {
  if (!draft.trim()) return null;
  const parsed = Number(draft);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
};

export const MixedNumberInput: React.FC<MixedNumberInputProps> = ({
  label, value, min, max, step, unit, disabled, onBegin, onPreview, onCommit, onCancel
}) => {
  const [draft, setDraft] = useState(value.kind === 'value' ? String(value.value) : '');
  const [editing, setEditing] = useState(false);
  const skipBlurRef = useRef(false);
  const editingRef = useRef(false);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  useEffect(() => () => {
    if (editingRef.current) commitRef.current();
  }, []);
  useEffect(() => {
    if (!editing) setDraft(value.kind === 'value' ? String(value.value) : '');
  }, [editing, value]);
  const cancel = () => {
    setDraft(value.kind === 'value' ? String(value.value) : '');
    setEditing(false);
    editingRef.current = false;
    onCancel();
  };
  const commit = () => {
    const parsed = parseBoundedNumber(draft, min, max);
    if (parsed === null) return cancel();
    onPreview(parsed);
    setEditing(false);
    editingRef.current = false;
    onCommit();
  };
  return (
    <label className="lighttable-tool-options__weight-field">
      <span>{label}</span>
      <input
        type="number" min={min} max={max} step={step}
        value={draft}
        placeholder={value.kind === 'mixed' ? 'Mixed' : ''}
        disabled={disabled || value.kind === 'unavailable'}
        aria-label={label}
        onFocus={() => { setEditing(true); editingRef.current = true; onBegin(); }}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          const parsed = parseBoundedNumber(next, min, max);
          if (parsed !== null) onPreview(parsed);
        }}
        onBlur={() => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            skipBlurRef.current = true;
            cancel();
            event.currentTarget.blur();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            skipBlurRef.current = true;
            commit();
            event.currentTarget.blur();
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const base = parseBoundedNumber(draft, min, max)
              ?? (value.kind === 'value' ? value.value : 0);
            const next = Math.max(min, Math.min(max, numericIncrement(
              base, event.key === 'ArrowUp' ? 1 : -1, step, event
            )));
            setDraft(String(next));
            onPreview(next);
          }
        }}
      />
      {unit ? <span>{unit}</span> : null}
    </label>
  );
};
