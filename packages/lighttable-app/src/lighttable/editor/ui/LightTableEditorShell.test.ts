import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { editorMenuEnabledForDocumentKind, LightTableEditorShell, type LightTableEditorShellProps } from './LightTableEditorShell';
import { EmptyToolOptionsBar, ToolOptionsBar, type ToolOptionsProps } from './ToolOptionsBar';
import { EditorToolbar } from './EditorToolbar';
import { createEditorSession } from '../session/editorSession';

const childrenOfType = (node: React.ReactNode, type: React.ElementType): React.ReactElement[] =>
  React.Children.toArray(node).flatMap(child => React.isValidElement<{ children?: React.ReactNode }>(child)
    ? [...(child.type === type ? [child] : []), ...childrenOfType(child.props.children, type)] : []);
const shellFixture = () => {
  const session = createEditorSession();
  const toolOptions = { activeTool: 'zoom', onBrushChange: vi.fn(), brush: session.brush,
    gradientEditorRequest: { revision: 2, endpoint: 'start' } } as unknown as ToolOptionsProps;
  const props: LightTableEditorShellProps = {
    screenMode: 'normal', active: true, saving: false, onClose: vi.fn(), menuOptionsFor: () => [],
    activeTool: 'brush', brush: session.brush, toolOptions, onZoomActual: vi.fn(), onToolChange: vi.fn(),
    onForegroundColorChange: vi.fn(), onBackgroundColorChange: vi.fn(), onSwapColors: vi.fn(), onResetColors: vi.fn(),
    fileInputRef: React.createRef<HTMLInputElement>(), advancedFileInputRef: React.createRef<HTMLInputElement>(),
    fastFileAccept: 'image/png', precisionFileAccept: '.psd', onFastFileChange: vi.fn(), onPrecisionFileChange: vi.fn(),
    children: null
  };
  return { props, toolOptions };
};

describe('Shell Tool Options composition', () => {
  it('forwards the cohesive projection unchanged while vertical toolbar keeps its independent inputs', () => {
    const { props, toolOptions } = shellFixture();
    const rendered = LightTableEditorShell(props) as React.ReactNode;
    const bar = childrenOfType(rendered, ToolOptionsBar)[0];
    expect(bar.props).toEqual(toolOptions);
    expect((bar.props as ToolOptionsProps).onBrushChange).toBe(toolOptions.onBrushChange);
    expect((bar.props as ToolOptionsProps).gradientEditorRequest).toBe(toolOptions.gradientEditorRequest);
    const vertical = childrenOfType(rendered, EditorToolbar)[0].props as React.ComponentProps<typeof EditorToolbar>;
    expect(vertical.activeTool).toBe('brush');
    expect(vertical.foregroundColor).toBe(props.brush.color);
    expect(vertical.backgroundColor).toBe(props.brush.backgroundColor);
    expect(vertical.onSwapColors).toBe(props.onSwapColors);
    expect(vertical.onResetColors).toBe(props.onResetColors);
    expect(vertical.onZoomActual).toBe(props.onZoomActual);
  });

  it('preserves canvas-only and non-image tool visibility decisions', () => {
    const { props } = shellFixture();
    const hidden = LightTableEditorShell({ ...props, screenMode: 'canvas-only' }) as React.ReactNode;
    expect(childrenOfType(hidden, ToolOptionsBar)).toHaveLength(0);
    expect(childrenOfType(hidden, EditorToolbar)).toHaveLength(0);
    const video = LightTableEditorShell({ ...props, workspaceDocumentKind: 'video' }) as React.ReactNode;
    expect(childrenOfType(video, ToolOptionsBar)).toHaveLength(0);
    expect(childrenOfType(video, EmptyToolOptionsBar)).toHaveLength(1);
    const zoom = LightTableEditorShell({ ...props, workspaceDocumentKind: 'video', activeTool: 'zoom' }) as React.ReactNode;
    expect(childrenOfType(zoom, ToolOptionsBar)).toHaveLength(1);
  });
});

describe('editorMenuEnabledForDocumentKind', () => {
  it('keeps application menus but disables image-edit menus for video', () => {
    expect(editorMenuEnabledForDocumentKind('video', 'file')).toBe(true);
    expect(editorMenuEnabledForDocumentKind('video', 'edit')).toBe(true);
    expect(editorMenuEnabledForDocumentKind('video', 'ai')).toBe(true);
    expect(editorMenuEnabledForDocumentKind('video', 'view')).toBe(true);
    expect(editorMenuEnabledForDocumentKind('video', 'help')).toBe(true);
    for (const menu of ['image', 'layer', 'type', 'select', 'filter'] as const) {
      expect(editorMenuEnabledForDocumentKind('video', menu)).toBe(false);
    }
  });

  it('keeps the complete image editor menu surface for image documents', () => {
    for (const menu of ['file', 'edit', 'image', 'layer', 'type', 'select', 'filter', 'ai', 'view', 'help'] as const) {
      expect(editorMenuEnabledForDocumentKind('image', menu)).toBe(true);
    }
  });
});
