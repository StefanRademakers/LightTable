import { describe, expect, it, vi } from 'vitest';
import {
  bindEditorWindowInput,
  type EditorWindowInputHandlers,
  type EditorWindowInputTarget
} from './editorWindowInputBinding';

class FakeInputTarget implements EditorWindowInputTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: 'keydown' | 'keyup' | 'blur', listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: 'keydown' | 'keyup' | 'blur', listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: 'keydown' | 'keyup' | 'blur', event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

const keyboardEvent = (key: string, capsLock = false) => ({
  key,
  getModifierState: vi.fn((modifier: string) => modifier === 'CapsLock' && capsLock),
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  stopImmediatePropagation: vi.fn()
}) as unknown as KeyboardEvent;

const handlers = (
  patch: Partial<EditorWindowInputHandlers> = {}
): EditorWindowInputHandlers => ({
  onKeyDown: () => false,
  onKeyUp: () => false,
  onShiftChange: vi.fn(),
  onAltChange: vi.fn(),
  onCapsLockChange: vi.fn(),
  onBlur: vi.fn(),
  ...patch
});

describe('bindEditorWindowInput', () => {
  it('consumes only keyboard events claimed by the active editor', () => {
    const target = new FakeInputTarget();
    const current = handlers({ onKeyDown: () => true });
    const dispose = bindEditorWindowInput(target, () => current);
    const event = keyboardEvent('a');

    target.dispatch('keydown', event as unknown as Event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    dispose();
  });

  it('reads current handlers without rebinding listeners', () => {
    const target = new FakeInputTarget();
    const first = vi.fn(() => false);
    const second = vi.fn(() => false);
    let current = handlers({ onKeyDown: first });
    const dispose = bindEditorWindowInput(target, () => current);

    current = handlers({ onKeyDown: second });
    target.dispatch('keydown', keyboardEvent('x') as unknown as Event);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(target.count('keydown')).toBe(1);
    dispose();
  });

  it('tracks Shift/Alt and clears modifiers and temporary state on blur', () => {
    const target = new FakeInputTarget();
    const onShiftChange = vi.fn();
    const onAltChange = vi.fn();
    const onBlur = vi.fn();
    const dispose = bindEditorWindowInput(
      target,
      () => handlers({ onShiftChange, onAltChange, onBlur })
    );

    target.dispatch('keydown', keyboardEvent('Shift') as unknown as Event);
    target.dispatch('keyup', keyboardEvent('Shift') as unknown as Event);
    target.dispatch('keydown', keyboardEvent('Alt') as unknown as Event);
    target.dispatch('keyup', keyboardEvent('Alt') as unknown as Event);
    target.dispatch('blur', {} as Event);

    expect(onShiftChange.mock.calls).toEqual([[true], [false], [false]]);
    expect(onAltChange.mock.calls).toEqual([[true], [false], [false]]);
    expect(onBlur).toHaveBeenCalledOnce();
    dispose();
  });

  it('publishes and clears the Caps Lock precise-cursor state', () => {
    const target = new FakeInputTarget();
    const onCapsLockChange = vi.fn();
    const dispose = bindEditorWindowInput(
      target,
      () => handlers({ onCapsLockChange })
    );
    const event = keyboardEvent('CapsLock', true);

    target.dispatch('keydown', event as unknown as Event);
    target.dispatch('blur', {} as Event);

    expect(onCapsLockChange.mock.calls).toEqual([[true], [false]]);
    dispose();
  });

  it('removes every listener when the editor is deactivated', () => {
    const target = new FakeInputTarget();
    const dispose = bindEditorWindowInput(target, () => handlers());

    dispose();

    expect(target.count('keydown')).toBe(0);
    expect(target.count('keyup')).toBe(0);
    expect(target.count('blur')).toBe(0);
  });
});
