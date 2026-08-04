import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  TextInputBridge,
  textInputCommandFromBeforeInput,
  textInputFormatCommandFromKey
} from './TextInputBridge';

describe('TextInputBridge', () => {
  it('maps browser beforeinput operations without treating composition as plain typing', () => {
    expect(textInputCommandFromBeforeInput('insertText', 'é'))
      .toEqual({ kind: 'insert', text: 'é' });
    expect(textInputCommandFromBeforeInput('insertParagraph', null))
      .toEqual({ kind: 'insert', text: '\n' });
    expect(textInputCommandFromBeforeInput('deleteContentBackward', null))
      .toEqual({ kind: 'delete', direction: 'backward', unit: 'grapheme' });
    expect(textInputCommandFromBeforeInput('deleteWordForward', null))
      .toEqual({ kind: 'delete', direction: 'forward', unit: 'word' });
    expect(textInputCommandFromBeforeInput(undefined, undefined)).toBeNull();
    expect(textInputCommandFromBeforeInput(undefined, 'x'))
      .toEqual({ kind: 'insert', text: 'x' });
    expect(textInputCommandFromBeforeInput('insertText', undefined)).toBeNull();
    expect(textInputCommandFromBeforeInput('insertCompositionText', '編')).toBeNull();
  });

  it('maps Photoshop-compatible character formatting shortcuts', () => {
    const key = (value: string, overrides: Partial<{
      ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean
    }> = {}) => textInputFormatCommandFromKey({
      key: value, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...overrides
    });
    expect(key('B', { ctrlKey: true, shiftKey: true })).toBe('toggle-bold');
    expect(key('u', { metaKey: true, shiftKey: true })).toBe('toggle-underline');
    expect(key('ArrowRight', { altKey: true })).toBe('increase-tracking');
    expect(key('ArrowUp', { altKey: true, shiftKey: true })).toBe('baseline-up');
    expect(key('.', { ctrlKey: true, shiftKey: true })).toBe('increase-size');
  });

  it('is an accessible but visually delegated multiline input surface', () => {
    const noop = vi.fn();
    const markup = renderToStaticMarkup(
      <TextInputBridge
        label="Edit Headline" text="Full selected value" selectionStart={5}
        selectionEnd={13} focusKey={1} selectedText="selected" onEdit={noop}
        onNavigate={noop} onFormat={noop} onCompositionStart={noop} onCompositionUpdate={noop}
        onCompositionEnd={noop} onPaste={noop} onCut={noop}
        onCheckpoint={noop}
        onCommit={noop} onCancel={noop}
      />
    );
    expect(markup).toContain('aria-label="Edit Headline"');
    expect(markup).toContain('aria-multiline="true"');
    expect(markup).toContain('data-editor-native-tab-navigation="true"');
    expect(markup).toContain('lighttable-text-input-bridge');
  });
});
