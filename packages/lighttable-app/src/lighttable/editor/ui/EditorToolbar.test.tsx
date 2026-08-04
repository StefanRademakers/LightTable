import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EditorToolbar } from './EditorToolbar';

const renderToolbar = (activeTool: 'brush' | 'select-free' | 'shape-triangle' | 'text-point' | 'vector-add-anchor') => renderToStaticMarkup(
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

  it('collapses pen modes and projects the active mode into their master slot', () => {
    const defaultMarkup = renderToolbar('brush');
    expect(defaultMarkup).toContain('aria-label="Pen (P)"');
    expect(defaultMarkup).toContain('aria-label="Show pen tools"');
    expect(defaultMarkup).not.toContain('aria-label="Add anchor point"');

    const activeMarkup = renderToolbar('vector-add-anchor');
    expect(activeMarkup).toContain('aria-label="Add anchor point"');
    expect(activeMarkup).not.toContain('aria-label="Pen (P)"');
  });

  it('exposes one Type Tool for click-created point and drag-created paragraph text', () => {
    const markup = renderToolbar('text-point');
    expect(markup).toContain('aria-label="Type tool (T)"');
    expect(markup).toContain('aria-label="Show text tools"');
    expect(markup).not.toContain('aria-label="Paragraph text"');
    expect(markup).toContain('aria-pressed="true"');
  });
});
