export interface EditorWindowInputTarget {
  addEventListener(
    type: 'keydown' | 'keyup',
    listener: EventListener,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(type: 'blur', listener: EventListener): void;
  removeEventListener(
    type: 'keydown' | 'keyup',
    listener: EventListener,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener(type: 'blur', listener: EventListener): void;
}

export interface EditorWindowInputHandlers {
  readonly onKeyDown: (event: KeyboardEvent) => boolean;
  readonly onKeyUp: (event: KeyboardEvent) => boolean;
  readonly onShiftChange: (pressed: boolean) => void;
  readonly onAltChange: (pressed: boolean) => void;
  readonly onCapsLockChange: (active: boolean) => void;
  readonly onBlur: () => void;
}

const consumeKeyboardEvent = (event: KeyboardEvent): void => {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
};

const capsLockActive = (event: KeyboardEvent) => (
  typeof event.getModifierState === 'function' && event.getModifierState('CapsLock')
);

/**
 * Owns the editor's global keyboard subscription as one disposable resource.
 * The binding deliberately knows nothing about React or document state; callers
 * provide current handlers and decide which commands belong to the active
 * document.
 */
export const bindEditorWindowInput = (
  target: EditorWindowInputTarget,
  getHandlers: () => EditorWindowInputHandlers
): (() => void) => {
  const handleKeyDown: EventListener = (rawEvent) => {
    const event = rawEvent as KeyboardEvent;
    const handlers = getHandlers();
    if (event.key === 'Shift') handlers.onShiftChange(true);
    if (event.key === 'Alt') handlers.onAltChange(true);
    handlers.onCapsLockChange(capsLockActive(event));
    if (handlers.onKeyDown(event)) consumeKeyboardEvent(event);
  };
  const handleKeyUp: EventListener = (rawEvent) => {
    const event = rawEvent as KeyboardEvent;
    const handlers = getHandlers();
    if (event.key === 'Shift') handlers.onShiftChange(false);
    if (event.key === 'Alt') handlers.onAltChange(false);
    handlers.onCapsLockChange(capsLockActive(event));
    if (handlers.onKeyUp(event)) consumeKeyboardEvent(event);
  };
  const handleBlur: EventListener = () => {
    const handlers = getHandlers();
    handlers.onShiftChange(false);
    handlers.onAltChange(false);
    handlers.onCapsLockChange(false);
    handlers.onBlur();
  };

  // Capture prevents page-level history and shortcuts from racing the active
  // LightTable document.
  target.addEventListener('keydown', handleKeyDown, true);
  target.addEventListener('keyup', handleKeyUp, true);
  target.addEventListener('blur', handleBlur);

  return () => {
    target.removeEventListener('keydown', handleKeyDown, true);
    target.removeEventListener('keyup', handleKeyUp, true);
    target.removeEventListener('blur', handleBlur);
  };
};
