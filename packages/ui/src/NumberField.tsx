import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { TextInput, type TextInputProps } from './TextInput';
import { numericIncrement, parseBoundedNumber, resolveNumericExpression, type NumericExpressionKind } from './numericExpression';

export interface NumberFieldProps extends Omit<TextInputProps, 'type' | 'value' | 'defaultValue' | 'onChange'> {
  value: number | null;
  kind?: NumericExpressionKind;
  formatValue?: (value: number) => string;
  onValueChange: (value: number) => void;
  /** Optional values retain an empty draft instead of coercing it to zero. */
  onEmpty?: () => void;
  /** Settings can publish immediately; document edits can preview then commit once. */
  updateMode?: 'commit' | 'input';
  bounds?: 'clamp' | 'reject';
  onBegin?: () => void;
  onPreview?: (value: number) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  blurOnCommit?: boolean;
  commitOnUnmount?: boolean;
}

/** One TextInput. Drafts never leak partial expressions or empty strings as zero. */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField({
  value, kind = 'float', formatValue = String, min = -Infinity, max = Infinity, step = 1,
  onValueChange, onEmpty, updateMode = 'commit', bounds = 'clamp', onBegin, onPreview, onCommit, onCancel,
  blurOnCommit = false, commitOnUnmount = false, onFocus, onBlur, onKeyDown, disabled, readOnly, ...props
}, ref) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!, []);
  const format = (number: number | null) => number === null || !Number.isFinite(number) ? '' : formatValue(number);
  const [draft, setDraft] = useState(() => format(value));
  const draftRef = useRef(draft);
  const session = useRef<{ initial: number | null; published: number | null; preview: number | null; dirty: boolean } | null>(null);
  const display = (text: string) => { draftRef.current = text; setDraft(text); };
  useEffect(() => { if (!session.current) display(format(value)); }, [value, formatValue]);
  const begin = () => {
    if (session.current) return;
    session.current = { initial: value, published: value, preview: value, dirty: false };
    onBegin?.();
  };
  const bounded = (next: number) => Math.min(Number(max), Math.max(Number(min), next));
  const parse = (text: string) => resolveNumericExpression(text, kind);
  const publish = (next: number, preview: boolean) => {
    const current = session.current!;
    if (preview && onPreview) {
      if (next !== current.preview) { current.preview = next; onPreview(next); }
    } else if (next !== current.published) { current.published = next; onValueChange(next); }
  };
  const cancel = () => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    display(format(onCancel || updateMode === 'input' ? current.initial : current.published));
    if (onCancel) onCancel();
    else if (updateMode === 'input' && current.published !== current.initial) {
      if (current.initial === null || !Number.isFinite(current.initial)) onEmpty?.();
      else onValueChange(current.initial);
    }
  };
  const finish = () => {
    const current = session.current;
    if (!current) return;
    if (!draftRef.current.trim() && onEmpty) {
      session.current = null;
      if (current.published !== null) onEmpty();
      display(''); onCommit?.(); return;
    }
    const parsed = parse(draftRef.current);
    if (parsed === null || (bounds === 'reject' && bounded(parsed) !== parsed)) { cancel(); return; }
    const next = bounded(parsed);
    session.current = null;
    // Preview consumers still receive the final value, then exactly one transaction end.
    if (current.dirty && (onPreview ? next !== current.preview : next !== current.published)) onValueChange(next);
    display(format(next));
    onCommit?.();
  };
  const cleanup = useRef(() => {});
  cleanup.current = () => { if (commitOnUnmount) finish(); };
  useEffect(() => () => cleanup.current(), []);

  return <TextInput {...props} ref={input} type="text" inputMode="decimal"
    data-suite-control="numeric-expression" value={draft} disabled={disabled} readOnly={readOnly}
    onFocus={event => { if (!readOnly) begin(); onFocus?.(event); }}
    onChange={event => {
      begin(); session.current!.dirty = true;
      const text = event.currentTarget.value;
      display(text);
      if (!text.trim() && onEmpty && updateMode === 'input') {
        if (session.current!.published !== null) { session.current!.published = null; onEmpty(); }
        return;
      }
      const parsed = parse(text);
      if (parsed !== null && parseBoundedNumber(String(parsed), Number(min), Number(max)) !== null) {
        if (onPreview) publish(parsed, true);
        else if (updateMode === 'input') publish(parsed, false);
      }
    }}
    onBlur={event => { finish(); onBlur?.(event); }}
    onKeyDown={event => {
      onKeyDown?.(event);
      if (event.defaultPrevented || event.nativeEvent.isComposing || readOnly || disabled) return;
      if (event.key === 'Enter') {
        event.preventDefault(); finish();
        if (blurOnCommit) event.currentTarget.blur();
      } else if (event.key === 'Escape' && session.current) {
        const changed = session.current.dirty;
        cancel();
        if (changed || onCancel) { event.preventDefault(); event.stopPropagation(); }
        if (blurOnCommit) event.currentTarget.blur();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); begin(); session.current!.dirty = true;
        const incremented = numericIncrement(parse(draftRef.current) ?? value ?? 0,
          event.key === 'ArrowUp' ? 1 : -1, Number(step) || 1, event);
        const next = bounded(kind === 'integer' ? Math.round(incremented) : Number(incremented.toFixed(10)));
        display(format(next));
        publish(next, Boolean(onPreview));
      }
    }} />;
});
