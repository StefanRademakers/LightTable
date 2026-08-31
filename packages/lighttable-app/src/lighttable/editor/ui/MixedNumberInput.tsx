import { NumberField } from '@lighttable/ui';
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

/** The editor owns the formatting transaction; the package owns numeric editing. */
export function MixedNumberInput({ label, value, unit, disabled, onPreview, ...props }: MixedNumberInputProps) {
  return <label className="lighttable-tool-options__weight-field">
    <span>{label}</span>
    <NumberField {...props} value={value.kind === 'value' ? value.value : null}
      placeholder={value.kind === 'mixed' ? 'Mixed' : ''}
      disabled={disabled || value.kind === 'unavailable'} aria-label={label}
      onValueChange={onPreview} onPreview={onPreview} bounds="reject" blurOnCommit commitOnUnmount />
    {unit ? <span>{unit}</span> : null}
  </label>;
}
