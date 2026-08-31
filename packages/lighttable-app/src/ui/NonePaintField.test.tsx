import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NonePaintField } from '@lighttable/ui';

describe('NonePaintField', () => {
  it('uses the canonical regular paint-field shape', () => {
    const markup = renderToStaticMarkup(
      <NonePaintField ariaLabel="No paint" expanded onClick={vi.fn()} />
    );
    expect(markup).toContain('data-suite-control="none-paint"');
    expect(markup).toContain('data-kind="none"');
    expect(markup).toContain('class="ui-paint-field__chevron"');
    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).toContain('aria-expanded="true"');
  });

  it('offers the same compact variant as the other paint fields', () => {
    const markup = renderToStaticMarkup(
      <NonePaintField ariaLabel="No paint" size="compact" onClick={vi.fn()} />
    );
    expect(markup).toContain('data-suite-control="none-paint"');
  });
});
