import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EditorToolbar } from './EditorToolbar';

const renderToolbar = (activeTool: 'brush' | 'select-free' | 'shape-triangle') => renderToStaticMarkup(
  <EditorToolbar
    activeTool={activeTool}
    foregroundColor="#000000"
    backgroundColor="#ffffff"
    onToolChange={vi.fn()}
    onForegroundColorChange={vi.fn()}
    onBackgroundColorChange={vi.fn()}
    onSwapColors={vi.fn()}
    onResetColors={vi.fn()}
  />
);

describe('EditorToolbar', () => {
  it('collapses selection tools into one master slot', () => {
    const markup = renderToolbar('brush');
    expect(markup).toContain('aria-label="Rectangular selection (M)"');
    expect(markup).toContain('aria-label="Show selection tools"');
    expect(markup).toContain('aria-haspopup="true"');
    expect(markup).not.toContain('aria-label="Elliptical selection (Shift+M)"');
  });

  it('projects the active selection tool into the master slot', () => {
    const markup = renderToolbar('select-free');
    expect(markup).toContain('aria-label="Free selection (L)"');
    expect(markup).not.toContain('aria-label="Rectangular selection (M)"');
  });

  it('collapses shapes and projects the active shape into their master slot', () => {
    const defaultMarkup = renderToolbar('brush');
    expect(defaultMarkup).toContain('aria-label="Rectangle (U)"');
    expect(defaultMarkup).toContain('aria-label="Show shape tools"');
    expect(defaultMarkup).not.toContain('aria-label="Ellipse (Shift+U)"');

    const activeMarkup = renderToolbar('shape-triangle');
    expect(activeMarkup).toContain('aria-label="Triangle"');
    expect(activeMarkup).not.toContain('aria-label="Rectangle (U)"');
  });
});
