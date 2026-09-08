import { describe, expect, it } from 'vitest';
import {
  inputAcceptsTextEditing,
  isTextEditingInputType
} from './useEditorKeyboardController';

describe('useEditorKeyboardController input ownership', () => {
  it.each([
    'text', 'search', 'email', 'url', 'tel', 'password', 'number',
    'date', 'datetime-local', 'month', 'time', 'week'
  ])('keeps editor shortcuts out of editable %s inputs', (type) => {
    expect(isTextEditingInputType(type)).toBe(true);
  });

  it.each([
    'checkbox', 'radio', 'button', 'submit', 'reset', 'range',
    'color', 'file', 'hidden'
  ])('does not mistake a focused %s control for text editing', (type) => {
    expect(isTextEditingInputType(type)).toBe(false);
  });

  it('does not treat a read-only layer-name field as active text editing', () => {
    expect(inputAcceptsTextEditing('text', true, false)).toBe(false);
    expect(inputAcceptsTextEditing('text', false, true)).toBe(false);
    expect(inputAcceptsTextEditing('text', false, false)).toBe(true);
  });
});
