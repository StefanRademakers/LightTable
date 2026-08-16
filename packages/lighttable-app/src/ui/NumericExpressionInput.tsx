import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type InputHTMLAttributes
} from 'react';
import { FormInput } from './FormInput';
import {
  resolveNumericExpression,
  type NumericExpressionKind
} from './numericExpression';

export interface NumericExpressionInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'onBlur'
> {
  readonly value: number;
  readonly kind?: NumericExpressionKind;
  readonly onValueChange: (value: number) => void;
  readonly formatValue?: (value: number) => string;
  readonly onBlur?: InputHTMLAttributes<HTMLInputElement>['onBlur'];
}

const defaultFormat = (value: number) => String(value);

/** A reusable int/float field with safe inline arithmetic such as 1920/2. */
export const NumericExpressionInput = forwardRef<HTMLInputElement, NumericExpressionInputProps>(
  function NumericExpressionInput({
    value,
    kind = 'float',
    onValueChange,
    formatValue = defaultFormat,
    step = 1,
    min,
    max,
    onFocus,
    onBlur,
    onKeyDown,
    ...props
  }, forwardedRef) {
    const inputRef = useRef<HTMLInputElement>(null);
    const focusedRef = useRef(false);
    const [draft, setDraft] = useState(() => formatValue(value));
    useImperativeHandle(forwardedRef, () => inputRef.current!, []);

    useEffect(() => {
      if (!focusedRef.current) setDraft(formatValue(value));
    }, [formatValue, value]);

    const bounded = (next: number) => {
      const minimum = typeof min === 'number' ? min : min === undefined ? -Infinity : Number(min);
      const maximum = typeof max === 'number' ? max : max === undefined ? Infinity : Number(max);
      return Math.min(maximum, Math.max(minimum, next));
    };
    const commit = () => {
      const parsed = resolveNumericExpression(draft, kind);
      if (parsed === null) {
        setDraft(formatValue(value));
        return false;
      }
      const next = bounded(parsed);
      onValueChange(next);
      setDraft(formatValue(next));
      return true;
    };

    return (
      <FormInput
        {...props}
        data-suite-control="numeric-expression"
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={draft}
        onFocus={(event) => {
          focusedRef.current = true;
          onFocus?.(event);
        }}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onBlur={(event) => {
          commit();
          focusedRef.current = false;
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape' && draft !== formatValue(value)) {
            event.preventDefault();
            event.stopPropagation();
            setDraft(formatValue(value));
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const parsed = resolveNumericExpression(draft, kind) ?? value;
            const amount = (typeof step === 'number' ? step : Number(step) || 1) * (event.shiftKey ? 10 : 1);
            const next = bounded(parsed + (event.key === 'ArrowUp' ? amount : -amount));
            onValueChange(next);
            setDraft(formatValue(next));
          }
        }}
      />
    );
  }
);
