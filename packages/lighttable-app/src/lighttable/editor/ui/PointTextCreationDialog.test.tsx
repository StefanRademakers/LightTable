import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PointTextCreationDialog } from './PointTextCreationDialog';

describe('PointTextCreationDialog', () => {
  it('exposes labelled content and explicit commit/cancel actions', () => {
    const markup = renderToStaticMarkup(
      <PointTextCreationDialog
        value="Text"
        onChange={vi.fn()}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="Create text"');
    expect(markup).toContain('data-editor-native-tab-navigation="true"');
    expect(markup).toContain('class="ui-field-row__label">Text</span>');
    expect(markup).toContain('type="button" tabindex="0" class="ui-button"');
    expect(markup).toContain('>Cancel</button>');
    expect(markup).toContain('type="submit" tabindex="0" class="ui-button"');
    expect(markup).toContain('>Create</button>');
  });
});
