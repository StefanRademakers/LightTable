import React, { useEffect, useRef } from 'react';

export type TextInputEditCommand =
  | { readonly kind: 'insert'; readonly text: string }
  | { readonly kind: 'delete'; readonly direction: 'backward' | 'forward'; readonly unit: 'grapheme' | 'word' };

export type TextInputNavigationCommand =
  | 'backward' | 'forward' | 'word-backward' | 'word-forward'
  | 'line-start' | 'line-end' | 'document-start' | 'document-end'
  | 'line-up' | 'line-down' | 'select-all';

export const textInputCommandFromBeforeInput = (
  inputType: string | null | undefined,
  data: string | null | undefined
): TextInputEditCommand | null => {
  // React/Electron can expose the legacy beforeinput payload with character
  // data but without InputEvent.inputType. Active IME composition is filtered
  // by the bridge before this fallback is reached.
  if (!inputType && typeof data === 'string') return { kind: 'insert', text: data };
  if (inputType === 'insertText' || inputType === 'insertReplacementText') {
    return typeof data === 'string' ? { kind: 'insert', text: data } : null;
  }
  if (inputType === 'insertLineBreak' || inputType === 'insertParagraph') {
    return { kind: 'insert', text: '\n' };
  }
  if (inputType === 'deleteContentBackward') {
    return { kind: 'delete', direction: 'backward', unit: 'grapheme' };
  }
  if (inputType === 'deleteContentForward') {
    return { kind: 'delete', direction: 'forward', unit: 'grapheme' };
  }
  if (inputType === 'deleteWordBackward') {
    return { kind: 'delete', direction: 'backward', unit: 'word' };
  }
  if (inputType === 'deleteWordForward') {
    return { kind: 'delete', direction: 'forward', unit: 'word' };
  }
  return null;
};

export interface TextInputBridgeProps {
  readonly label: string;
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly focusKey: number;
  readonly selectedText: string;
  readonly onEdit: (command: TextInputEditCommand) => void;
  readonly onNavigate: (command: TextInputNavigationCommand, extend: boolean) => void;
  readonly onCompositionStart: () => void;
  readonly onCompositionUpdate: (text: string) => void;
  readonly onCompositionEnd: (text: string) => void;
  readonly onPaste: (text: string) => void;
  readonly onCut: () => void;
  readonly onCheckpoint: () => void;
  readonly onCommit: () => void;
  readonly onCancel: () => void;
}

const navigationFromKey = (
  event: Pick<React.KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>
): TextInputNavigationCommand | null => {
  const primary = event.ctrlKey || event.metaKey;
  if (event.key === 'ArrowLeft') return primary ? 'word-backward' : 'backward';
  if (event.key === 'ArrowRight') return primary ? 'word-forward' : 'forward';
  if (event.key === 'ArrowUp') return 'line-up';
  if (event.key === 'ArrowDown') return 'line-down';
  if (event.key === 'Home') return primary ? 'document-start' : 'line-start';
  if (event.key === 'End') return primary ? 'document-end' : 'line-end';
  return null;
};

/** Native input/IME bridge. Visible authored text and feedback remain WebGPU-owned. */
export const TextInputBridge: React.FC<TextInputBridgeProps> = ({
  label, text, selectionStart, selectionEnd, focusKey, selectedText, onEdit, onNavigate, onCompositionStart,
  onCompositionUpdate, onCompositionEnd, onPaste, onCut, onCheckpoint, onCommit, onCancel
}) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    inputRef.current?.focus({ preventScroll: true });
    return () => previouslyFocused?.focus({ preventScroll: true });
  }, [focusKey]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input || composingRef.current) return;
    if (input.value !== text) input.value = text;
    input.setSelectionRange(selectionStart, selectionEnd);
  }, [selectionEnd, selectionStart, text]);

  return (
    <textarea
      ref={inputRef}
      className="lighttable-text-input-bridge"
      aria-label={label}
      aria-multiline="true"
      autoCapitalize="sentences"
      autoComplete="off"
      autoCorrect="on"
      data-editor-native-tab-navigation="true"
      defaultValue={text}
      onBeforeInput={(event) => {
        if (composingRef.current) return;
        const native = event.nativeEvent as InputEvent;
        if (native.inputType?.includes('Composition')) return;
        const syntheticData = (event as unknown as { readonly data?: string | null }).data;
        const data = typeof native.data === 'string' ? native.data : syntheticData;
        const command = textInputCommandFromBeforeInput(native.inputType, data);
        if (!command) return;
        event.preventDefault();
        onEdit(command);
      }}
      onCompositionStart={() => {
        composingRef.current = true;
        onCompositionStart();
      }}
      onCompositionUpdate={(event) => onCompositionUpdate(event.data)}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        onCompositionEnd(event.data);
      }}
      onInput={() => {
        if (!composingRef.current && inputRef.current) {
          inputRef.current.value = text;
          inputRef.current.setSelectionRange(selectionStart, selectionEnd);
        }
      }}
      onCopy={(event) => {
        event.preventDefault();
        event.clipboardData.setData('text/plain', selectedText);
      }}
      onCut={(event) => {
        event.preventDefault();
        event.clipboardData.setData('text/plain', selectedText);
        if (selectedText) onCut();
      }}
      onPaste={(event) => {
        event.preventDefault();
        onPaste(event.clipboardData.getData('text/plain'));
      }}
      onBlur={onCheckpoint}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
          event.preventDefault(); event.stopPropagation(); onNavigate('select-all', false); return;
        }
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); onCancel(); return;
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault(); event.stopPropagation(); onCommit(); return;
        }
        const navigation = navigationFromKey(event);
        if (!navigation) return;
        event.preventDefault(); event.stopPropagation();
        onNavigate(navigation, event.shiftKey);
      }}
    />
  );
};
