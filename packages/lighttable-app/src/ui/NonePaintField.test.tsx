import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NonePaintField } from './NonePaintField';

describe('NonePaintField', () => {
  it('uses the canonical regular paint-field shape', () => {
    const markup = renderToStaticMarkup(
      <NonePaintField ariaLabel="No paint" expanded onClick={vi.fn()} />
    );
    expect(markup).toContain('class="none-paint-field none-paint-field--regular"');
    expect(markup).toContain('class="none-paint-field__preview"');
    expect(markup).toContain('class="paint-field__arrow"');
    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain('aria-expanded="true"');
  });

  it('offers the same compact variant as the other paint fields', () => {
    const markup = renderToStaticMarkup(
      <NonePaintField ariaLabel="No paint" size="compact" onClick={vi.fn()} />
    );
    expect(markup).toContain('class="none-paint-field none-paint-field--compact"');
  });
});
