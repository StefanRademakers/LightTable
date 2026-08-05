import React, { useEffect, useRef } from 'react';

export type TextInputEditCommand =
  | { readonly kind: 'insert'; readonly text: string }
  | { readonly kind: 'delete'; readonly direction: 'backward' | 'forward'; readonly unit: 'grapheme' | 'word' };

export type TextInputNavigationCommand =
  | 'backward' | 'forward' | 'word-backward' | 'word-forward'
  | 'paragraph-backward' | 'paragraph-forward'
  | 'line-start' | 'line-end' | 'document-start' | 'document-end'
  | 'line-up' | 'line-down' | 'select-all';

export type TextInputFormatCommand =
  | 'toggle-bold' | 'toggle-italic' | 'toggle-underline'
  | 'increase-size' | 'decrease-size'
  | 'increase-leading' | 'decrease-leading'
  | 'increase-tracking' | 'decrease-tracking'
  | 'baseline-up' | 'baseline-down';

export const textInputFormatCommandFromKey = (
  event: Pick<React.KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>
): TextInputFormatCommand | null => {
  const primary = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (primary && event.shiftKey && key === 'b') return 'toggle-bold';
  if (primary && event.shiftKey && key === 'i') return 'toggle-italic';
  if (primary && event.shiftKey && key === 'u') return 'toggle-underline';
  if (primary && event.shiftKey && (event.key === '>' || event.key === '.')) return 'increase-size';
  if (primary && event.shiftKey && (event.key === '<' || event.key === ',')) return 'decrease-size';
  if (event.altKey && event.shiftKey && event.key === 'ArrowUp') return 'baseline-up';
  if (event.altKey && event.shiftKey && event.key === 'ArrowDown') return 'baseline-down';
  if (event.altKey && event.key === 'ArrowUp') return 'decrease-leading';
  if (event.altKey && event.key === 'ArrowDown') return 'increase-leading';
  if (event.altKey && event.key === 'ArrowLeft') return 'decrease-tracking';
  if (event.altKey && event.key === 'ArrowRight') return 'increase-tracking';
  return null;
};

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

export const textInputDeleteCommandFromKey = (
  event: Pick<React.KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  platform = globalThis.navigator?.platform ?? ''
): TextInputEditCommand | null => {
  if (event.key !== 'Backspace' && event.key !== 'Delete') return null;
  const mac = /Mac|iPhone|iPad|iPod/i.test(platform);
  if (!mac && event.altKey && !event.ctrlKey && !event.metaKey) return null;
  return {
    kind: 'delete',
    direction: event.key === 'Backspace' ? 'backward' : 'forward',
    unit: (mac ? event.altKey : event.ctrlKey || event.metaKey) ? 'word' : 'grapheme'
  };
};

export interface TextInputBridgeProps {
  readonly label: string;
  readonly text: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly focusKey: number;
  readonly selectedText: string;
  readonly onEdit: (command: TextInputEditCommand) => void;
  readonly onNavigate: (
    command: TextInputNavigationCommand,
    extend: boolean
  ) => { readonly start: number; readonly end: number } | void;
  readonly onFormat: (command: TextInputFormatCommand) => void;
  readonly onCompositionStart: () => void;
  readonly onCompositionUpdate: (text: string) => void;
  readonly onCompositionEnd: (text: string) => void;
  readonly onPaste: (text: string) => void;
  readonly onCut: () => void;
  readonly onCheckpoint: () => void;
  readonly onCommit: () => void;
  readonly onCancel: () => void;
}

export const textInputNavigationFromKey = (
  event: Pick<React.KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  platform = globalThis.navigator?.platform ?? ''
): TextInputNavigationCommand | null => {
  const mac = /Mac|iPhone|iPad|iPod/i.test(platform);
  if (event.key === 'ArrowLeft') {
    if (mac && event.metaKey) return 'line-start';
    return (mac ? event.altKey : event.ctrlKey) ? 'word-backward' : 'backward';
  }
  if (event.key === 'ArrowRight') {
    if (mac && event.metaKey) return 'line-end';
    return (mac ? event.altKey : event.ctrlKey) ? 'word-forward' : 'forward';
  }
  if (event.key === 'ArrowUp') {
    if (mac && event.metaKey) return 'document-start';
    return (mac ? event.altKey : event.ctrlKey) ? 'paragraph-backward' : 'line-up';
  }
  if (event.key === 'ArrowDown') {
    if (mac && event.metaKey) return 'document-end';
    return (mac ? event.altKey : event.ctrlKey) ? 'paragraph-forward' : 'line-down';
  }
  const documentBoundary = mac ? event.metaKey : event.ctrlKey;
  if (event.key === 'Home') return documentBoundary ? 'document-start' : 'line-start';
  if (event.key === 'End') return documentBoundary ? 'document-end' : 'line-end';
  return null;
};

/** Native input/IME bridge. Visible authored text and feedback remain WebGPU-owned. */
export const TextInputBridge: React.FC<TextInputBridgeProps> = ({
  label, text, selectionStart, selectionEnd, focusKey, selectedText, onEdit, onNavigate, onCompositionStart,
  onFormat, onCompositionUpdate, onCompositionEnd, onPaste, onCut, onCheckpoint, onCommit, onCancel
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
        const deletion = textInputDeleteCommandFromKey(event);
        if (deletion) {
          // Chromium/React does not consistently surface deletion through
          // synthetic beforeinput. Owning keydown also prevents the native
          // textarea from briefly diverging from the semantic text model.
          event.preventDefault(); event.stopPropagation(); onEdit(deletion); return;
        }
        const format = textInputFormatCommandFromKey(event);
        if (format) {
          event.preventDefault(); event.stopPropagation(); onFormat(format); return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
          event.preventDefault(); event.stopPropagation();
          const selection = onNavigate('select-all', false);
          if (selection) inputRef.current?.setSelectionRange(selection.start, selection.end);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); onCancel(); return;
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault(); event.stopPropagation(); onCommit(); return;
        }
        const navigation = textInputNavigationFromKey(event);
        if (!navigation) return;
        event.preventDefault(); event.stopPropagation();
        const selection = onNavigate(navigation, event.shiftKey);
        if (selection) inputRef.current?.setSelectionRange(selection.start, selection.end);
      }}
    />
  );
};
