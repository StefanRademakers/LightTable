import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentViewportStatus } from './DocumentViewportStatus';

describe('viewport lifecycle status', () => {
  it('keeps a renderer failure visible instead of reporting loading; diagnostics are escaped text', () => {
    const markup = renderToStaticMarkup(<DocumentViewportStatus
      error={'<b>GPU validation failure</b>'} loading resident={false} ready={false} unavailable />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('&lt;b&gt;GPU validation failure&lt;/b&gt;');
    expect(markup).not.toContain('Loading image');
  });
  it('does not cover a resident image merely because presentation is suspended', () => {
    expect(renderToStaticMarkup(<DocumentViewportStatus
      loading={false} resident ready={false} unavailable={false} />)).toBe('');
  });
});
