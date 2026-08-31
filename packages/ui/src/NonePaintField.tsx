import React from 'react';
import { PaintField, type PaintFieldProps } from './PaintField';

export type NonePaintFieldProps = Omit<PaintFieldProps, 'kind' | 'value' | 'onSample' | 'sampling'>;

export const NonePaintField = React.forwardRef<HTMLButtonElement, NonePaintFieldProps>(function NonePaintField(props, ref) {
  return <PaintField ref={ref} {...props} kind="none" />;
});
