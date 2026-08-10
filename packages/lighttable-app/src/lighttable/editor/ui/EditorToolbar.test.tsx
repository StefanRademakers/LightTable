import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EditorToolbar } from './EditorToolbar';

const renderToolbar = (activeTool: 'brush' | 'select-free' | 'shape-triangle' | 'text-point' | 'vector-add-anchor' | 'vector-direct-select') => renderToStaticMarkup(
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
  it('splits selection tools into Photoshop-compatible M, L and W slots', () => {
    const markup = renderToolbar('brush');
    expect(markup).toContain('aria-label="Rectangular selection (M)"');
    expect(markup).toContain('aria-label="Show marquee tools"');
    expect(markup).toContain('aria-label="Free selection (L)"');
    expect(markup).toContain('aria-label="Show lasso tools"');
    expect(markup).toContain('aria-label="Magic Wand (W)"');
    expect(markup).not.toContain('aria-label="Elliptical selection (M)"');
  });

  it('projects the active lasso without replacing the marquee slot', () => {
    const markup = renderToolbar('select-free');
    expect(markup).toContain('aria-label="Free selection (L)"');
    expect(markup).toContain('aria-label="Rectangular selection (M)"');
  });

  it('collapses shapes and projects the active shape into their master slot', () => {
    const defaultMarkup = renderToolbar('brush');
    expect(defaultMarkup).toContain('aria-label="Rectangle (U)"');
    expect(defaultMarkup).toContain('aria-label="Show shape tools"');
    expect(defaultMarkup).not.toContain('aria-label="Ellipse (U)"');

    const activeMarkup = renderToolbar('shape-triangle');
    expect(activeMarkup).toContain('aria-label="Triangle (U)"');
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

  it('collapses Path and Direct Selection into one A slot', () => {
    const defaultMarkup = renderToolbar('brush');
    expect(defaultMarkup).toContain('aria-label="Path selection (A)"');
    expect(defaultMarkup).toContain('aria-label="Show path selection tools"');
    expect(defaultMarkup).not.toContain('aria-label="Direct selection (A)"');

    const activeMarkup = renderToolbar('vector-direct-select');
    expect(activeMarkup).toContain('aria-label="Direct selection (A)"');
    expect(activeMarkup).not.toContain('aria-label="Path selection (A)"');
  });

  it('orders the drawing families as Pen, Type, Path Selection and Shapes', () => {
    const markup = renderToolbar('brush');
    const pen = markup.indexOf('aria-label="Pen (P)"');
    const type = markup.indexOf('aria-label="Type tool (T)"');
    const path = markup.indexOf('aria-label="Path selection (A)"');
    const shape = markup.indexOf('aria-label="Rectangle (U)"');
    expect(pen).toBeLessThan(type);
    expect(type).toBeLessThan(path);
    expect(path).toBeLessThan(shape);
  });

  it('exposes one Type Tool for click-created point and drag-created paragraph text', () => {
    const markup = renderToolbar('text-point');
    expect(markup).toContain('aria-label="Type tool (T)"');
    expect(markup).toContain('aria-label="Show text tools"');
    expect(markup).not.toContain('aria-label="Paragraph text"');
    expect(markup).toContain('aria-pressed="true"');
  });

  it('places the shared expand-all action after Zoom and before the color controls', () => {
    const markup = renderToolbar('brush');
    const zoom = markup.indexOf('aria-label="Zoom (Z)"');
    const expand = markup.indexOf('aria-label="Expand all tool submenus"');
    const colors = markup.indexOf('aria-label="Foreground and background colors"');
    expect(zoom).toBeGreaterThan(-1);
    expect(expand).toBeGreaterThan(zoom);
    expect(colors).toBeGreaterThan(expand);
    expect(markup).toContain('more_horizontal.png');
  });
});
