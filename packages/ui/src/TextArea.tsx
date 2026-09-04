import { forwardRef, type TextareaHTMLAttributes } from 'react';

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  resize?: 'none' | 'vertical';
}

/** Shared multiline field; applications choose its width and may increase its minimum height. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({
  className = '', tabIndex = -1, resize = 'vertical', rows = 3, ...props
}, ref) {
  return <textarea {...props} ref={ref} rows={rows} tabIndex={tabIndex}
    className={`ui-text-area ${className}`} data-ui-component="text-area"
    data-suite-control="text-area" data-resize={resize} />;
});
