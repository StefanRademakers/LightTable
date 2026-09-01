import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

export interface FieldRowProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  labelWidth?: string;
  layout?: 'row' | 'column';
  children: ReactNode;
}

export function FieldRow({
  label, labelWidth, layout = 'row', children, className = '', style, ...props
}: FieldRowProps) {
  const fieldStyle = labelWidth
    ? { ...style, '--ui-field-label-width': labelWidth } as CSSProperties
    : style;
  return <div {...props} className={`ui-field-row ${className}`} style={fieldStyle}
    data-layout={layout} data-ui-component="field-row" data-suite-control="field-row">
    <span className="ui-field-row__label">{label}</span>
    {children}
  </div>;
}
