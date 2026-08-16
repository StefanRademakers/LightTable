import { ButtonBase } from '../../../ui/ButtonBase';
import React, { useEffect, useRef } from 'react';

interface PointTextCreationDialogProps {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export const PointTextCreationDialog: React.FC<PointTextCreationDialogProps> = ({
  value,
  onChange,
  onCommit,
  onCancel
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const restoreFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      if (restoreFocus?.isConnected) restoreFocus.focus();
    };
  }, []);
  return (
    <div
      ref={dialogRef}
      className="lighttable-point-text"
      role="dialog"
      aria-modal="true"
      aria-label="Create text"
      data-editor-native-tab-navigation
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled])'
        );
        if (!controls?.length) return;
        const first = controls[0]!;
        const last = controls[controls.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onCommit();
        }}
      >
        <label>
          <span>Text</span>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        </label>
        <div>
          <ButtonBase type="button" onClick={onCancel}>Cancel</ButtonBase>
          <ButtonBase type="submit" disabled={!value.length}>Create</ButtonBase>
        </div>
      </form>
    </div>
  );
};
