import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  TextInputBridge,
  textInputCommandFromBeforeInput,
  textInputDeleteCommandFromKey,
  textInputFormatCommandFromKey,
  textInputNavigationFromKey
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

  it('maps native deletion keys even when React omits beforeinput', () => {
    const key = (value: string, overrides: Partial<{
      ctrlKey: boolean; metaKey: boolean; altKey: boolean
    }> = {}) => textInputDeleteCommandFromKey({
      key: value, ctrlKey: false, metaKey: false, altKey: false, ...overrides
    });
    expect(key('Backspace')).toEqual({ kind: 'delete', direction: 'backward', unit: 'grapheme' });
    expect(key('Delete', { ctrlKey: true }))
      .toEqual({ kind: 'delete', direction: 'forward', unit: 'word' });
    expect(key('Backspace', { altKey: true })).toBeNull();
    expect(key('A')).toBeNull();
    expect(textInputDeleteCommandFromKey({
      key: 'Backspace', ctrlKey: false, metaKey: false, altKey: true
    }, 'MacIntel')).toEqual({ kind: 'delete', direction: 'backward', unit: 'word' });
  });

  it('uses native Windows and macOS text navigation conventions', () => {
    const key = (value: string, overrides: Partial<{
      ctrlKey: boolean; metaKey: boolean; altKey: boolean
    }> = {}, platform = 'Win32') => textInputNavigationFromKey({
      key: value, ctrlKey: false, metaKey: false, altKey: false, ...overrides
    }, platform);
    expect(key('ArrowRight', { ctrlKey: true })).toBe('word-forward');
    expect(key('ArrowDown', { ctrlKey: true })).toBe('paragraph-forward');
    expect(key('ArrowLeft', { altKey: true }, 'MacIntel')).toBe('word-backward');
    expect(key('ArrowRight', { metaKey: true }, 'MacIntel')).toBe('line-end');
    expect(key('ArrowUp', { metaKey: true }, 'MacIntel')).toBe('document-start');
    expect(key('ArrowDown', { altKey: true }, 'MacIntel')).toBe('paragraph-forward');
  });

  it('maps Photoshop-compatible character formatting shortcuts', () => {
    const key = (value: string, overrides: Partial<{
      ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean
    }> = {}) => textInputFormatCommandFromKey({
      key: value, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...overrides
    });
    expect(key('B', { ctrlKey: true, shiftKey: true })).toBe('toggle-bold');
    expect(key('u', { metaKey: true, shiftKey: true })).toBe('toggle-underline');
    expect(key('b', { ctrlKey: true })).toBe('toggle-bold');
    expect(key('i', { ctrlKey: true })).toBe('toggle-italic');
    expect(key('u', { ctrlKey: true })).toBe('toggle-underline');
    expect(key('Backspace', { altKey: true })).toBe('fill-foreground');
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
