import { useEffect, useRef } from 'react';
import {
  bindEditorWindowInput,
  type EditorWindowInputHandlers
} from '../../application/input/editorWindowInputBinding';

/**
 * React adapter for the host-neutral input binding. Handler changes are read
 * through a ref, so active document state can change without rebinding global
 * window listeners.
 */
export const useEditorWindowInput = (
  enabled: boolean,
  handlers: EditorWindowInputHandlers
): void => {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    return bindEditorWindowInput(window, () => handlersRef.current);
  }, [enabled]);
};
