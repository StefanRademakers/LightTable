import type { SelectOption, SelectProps } from './Select';
import { Select } from './Select';
import { FieldRow } from './FieldRow';

export interface SelectFieldProps extends Omit<SelectProps, 'value' | 'options' | 'children' | 'onValueChange'> {
  label: string;
  labelWidth?: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
}

export function SelectField({ label, labelWidth, value, options, onChange, ...props }: SelectFieldProps) {
  return <FieldRow label={label} labelWidth={labelWidth}>
    <Select {...props} value={value} options={options} onValueChange={onChange} />
  </FieldRow>;
}
