import {
  forwardRef,
  createElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type FormEventHandler,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import { Text } from './Text';

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const isAvailableControl = (element: HTMLElement) =>
  !element.closest('[hidden], [aria-hidden="true"], [inert]');

export interface DialogProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'onSubmit'> {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  size?: 'compact' | 'regular' | 'wide' | 'report';
  as?: 'div' | 'form' | 'section';
  onDismiss: () => void;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  backdropClassName?: string;
  closeOnBackdrop?: boolean;
}

export const Dialog = forwardRef<HTMLElement, DialogProps>(function Dialog({
  open,
  title,
  description,
  footer,
  children,
  size = 'regular',
  as = 'div',
  onDismiss,
  onSubmit,
  backdropClassName = '',
  closeOnBackdrop = false,
  className = '',
  onKeyDown,
  ...props
}, forwardedRef) {
  const surfaceRef = useRef<HTMLElement | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useImperativeHandle(forwardedRef, () => surfaceRef.current as HTMLElement, []);

  useEffect(() => {
    if (!open) return undefined;
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const surface = surfaceRef.current;
      const autofocus = surface?.querySelector<HTMLElement>('[autofocus]');
      (autofocus ?? surface?.querySelector<HTMLElement>(FOCUSABLE) ?? surface)?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (restore?.isConnected) restore.focus();
    };
  }, [open]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismissRef.current();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...(surfaceRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
      .filter(isAvailableControl);
    if (!controls.length) {
      event.preventDefault();
      surfaceRef.current?.focus();
      return;
    }
    const first = controls[0]!;
    const last = controls[controls.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, [onKeyDown]);

  if (!open) return null;
  const surface = createElement(as, {
    ...props,
    ref: surfaceRef,
    className: `ui-dialog${className ? ` ${className}` : ''}`,
    'data-size': size,
    'data-ui-component': 'dialog',
    'data-suite-control': 'dialog',
    role: 'dialog',
    'aria-modal': true,
    'aria-label': props['aria-label'] ?? (typeof title === 'string' ? title : undefined),
    tabIndex: -1,
    'data-editor-native-tab-navigation': true,
    ...(as === 'form' ? { onSubmit } : {}),
    onKeyDown: handleKeyDown,
    onClick: (event: MouseEvent<HTMLElement>) => event.stopPropagation()
  },
  <Text as="h2" className="ui-dialog__title" variant="large" weight="bold">{title}</Text>,
  description ? <Text as="p" className="ui-dialog__description" tone="muted">{description}</Text> : null,
  children,
  footer ? <div className="ui-dialog__footer">{footer}</div> : null);
  if (typeof document === 'undefined') return surface;
  return createPortal(
    <div className={`ui-dialog-backdrop${backdropClassName ? ` ${backdropClassName}` : ''}`}
      data-ui-component="dialog-backdrop"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) dismissRef.current();
      }}>
      {surface}
    </div>,
    document.body
  );
});
