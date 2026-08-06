import { useCallback, useEffect, useRef } from 'react';

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

/** Shared modal focus, Escape and Tab containment without owning presentation. */
export const useDialogAccessibility = <Element extends HTMLElement>(
  open: boolean,
  onEscape: () => void
) => {
  const dialogRef = useRef<Element | null>(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!open) return undefined;
    const restore = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const autofocus = dialog?.querySelector<HTMLElement>('[autofocus]');
      const first = autofocus ?? dialog?.querySelector<HTMLElement>(FOCUSABLE) ?? dialog;
      first?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (restore?.isConnected) restore.focus();
    };
  }, [open]);

  const onDialogKeyDown = useCallback((event: React.KeyboardEvent<Element>) => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      escapeRef.current();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!controls.length) {
      event.preventDefault();
      dialogRef.current?.focus();
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
  }, []);

  return { dialogRef, onDialogKeyDown };
};
