import type { HTMLAttributes } from 'react';

export type TextVariant = 'small' | 'regular' | 'large';
export type TextWeight = 'normal' | 'bold';
export type TextTone = 'default' | 'muted';

export interface TextProps extends Omit<HTMLAttributes<HTMLElement>, 'color'> {
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'code';
  variant?: TextVariant;
  weight?: TextWeight;
  tone?: TextTone;
}

/** One semantic element, no wrappers. Visual type is independent of heading level. */
export function Text({
  as: Element = 'span',
  variant = 'regular',
  weight = 'normal',
  tone = 'default',
  className,
  ...props
}: TextProps) {
  return <Element {...props}
    className={className ? `ui-text ${className}` : 'ui-text'}
    data-ui-component="text" data-variant={variant} data-weight={weight} data-tone={tone}
  />;
}
