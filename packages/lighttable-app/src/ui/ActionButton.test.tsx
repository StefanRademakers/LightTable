import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionButton } from './ActionButton';

describe('ActionButton', () => {
  it('exposes the canonical regular, control and compact density variants', () => {
    const markup = renderToStaticMarkup(<>
      <ActionButton>Regular</ActionButton>
      <ActionButton size="control">Control</ActionButton>
      <ActionButton size="compact">Compact</ActionButton>
    </>);

    expect(markup).toContain('class="action-button"');
    expect(markup).toContain('class="action-button action-button--control"');
    expect(markup).toContain('class="action-button action-button--compact"');
  });
});
