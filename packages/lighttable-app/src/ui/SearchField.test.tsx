import { SearchField } from '@lighttable/ui';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';


describe('SearchField', () => {
  it('only exposes its clear action while a controlled value is present', () => {
    const empty = renderToStaticMarkup(<SearchField value="" onClear={() => undefined} />);
    const populated = renderToStaticMarkup(<SearchField value="portrait" onClear={() => undefined} />);
    expect(empty).not.toContain('Clear search');
    expect(populated).toContain('Clear search');
    expect(populated).toContain('close.png');
  });
});
