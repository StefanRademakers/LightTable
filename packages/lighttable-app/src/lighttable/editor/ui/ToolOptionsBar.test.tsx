import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createEditorSession, type ToolId } from '../session/editorSession';
import { ToolOptionsContent, type ToolOptionsProps } from './ToolOptionsBar';

const renderOptions = (activeTool: ToolId, rowHeight = 1, columnWidth = 1) => {
  const session = createEditorSession();
  const props: ToolOptionsProps = {
    activeTool,
    brush: session.brush,
    warp: session.warp,
    vectorStyle: session.vectorStyle,
    selectionPixelSnap: session.selectionPixelSnap,
    selectionCombineMode: session.selectionCombineMode,
    selectionRowHeight: rowHeight,
    selectionColumnWidth: columnWidth,
    zoomPercent: 100,
    onBrushChange: vi.fn(),
    onWarpChange: vi.fn(),
    onVectorStyleChange: vi.fn(),
    onWarpReset: vi.fn(),
    onSelectionPixelSnapChange: vi.fn(),
    onSelectionCombineModeChange: vi.fn(),
    onSelectionRowHeightChange: vi.fn(),
    onSelectionColumnWidthChange: vi.fn(),
    onZoomPreset: vi.fn(),
    onZoomFit: vi.fn()
  };
  return renderToStaticMarkup(<ToolOptionsContent {...props} />);
};

describe('selection strip tool options', () => {
  it('shows a pixel height for horizontal selections', () => {
    const markup = renderOptions('select-horizontal', 3, 7);
    expect(markup).toContain('Horizontal selection');
    expect(markup).toContain('<span>Height</span>');
    expect(markup).toContain('value="3"');
  });

  it('shows an independent pixel width for vertical selections', () => {
    const markup = renderOptions('select-vertical', 3, 7);
    expect(markup).toContain('Vertical selection');
    expect(markup).toContain('<span>Width</span>');
    expect(markup).toContain('value="7"');
  });
});
