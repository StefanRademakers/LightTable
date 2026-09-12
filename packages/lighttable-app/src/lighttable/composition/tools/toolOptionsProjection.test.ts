import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createEditorSession } from '../../editor/session/editorSession';
import type { ToolOptionsFeatureProjection } from '../../editor/ui/ToolOptionsBar';
import type { ToolOptionsContextMenuProps } from '../../editor/ui/ToolOptionsContextMenu';
import { projectToolOptions } from './toolOptionsProjection';

describe('Tool Options surface projection', () => {
  it('preserves all shared values and command identities except the context-only Warp close wrapper', () => {
    const session = createEditorSession();
    // Representative opaque feature values: this projection never reads or materializes their internals.
    const shared = { activeTool: 'brush', brush: session.brush, warp: session.warp, text: session.text,
      selectionPaintBrush: session.selectionPaintBrush, faceWarp: {},
      onBrushChange: vi.fn(), onTextSizeChange: vi.fn(), onSelectionCombineModeChange: vi.fn(),
      onWarpChange: vi.fn(), onWarpReset: vi.fn() } as unknown as ToolOptionsFeatureProjection;
    const request = { revision: 3, endpoint: 'end' as const }, close = vi.fn();
    const result = projectToolOptions(shared, request, close);
    for (const [key, value] of Object.entries(shared)) {
      expect(result.toolbar[key as keyof typeof shared]).toBe(value);
      if (key !== 'onWarpReset') expect(result.contextMenu[key as keyof typeof shared]).toBe(value);
    }
    expect(Object.keys(result.toolbar).filter(key => !(key in shared))).toEqual(['gradientEditorRequest']);
    expect(Object.keys(result.contextMenu).filter(key => !(key in shared))).toEqual(['onClose']);
    expect(result.toolbar.gradientEditorRequest).toBe(request);
    expect(result.contextMenu).not.toHaveProperty('gradientEditorRequest');
    expect(result.contextMenu.onClose).toBe(close);
    expectTypeOf<ToolOptionsFeatureProjection>().not.toHaveProperty('gradientEditorRequest');
    expectTypeOf<ToolOptionsContextMenuProps>().not.toHaveProperty('gradientEditorRequest');
  });

  it('keeps toolbar Reset open, while context Reset finishes the same command before closing', () => {
    const calls: string[] = [];
    const shared = { onWarpReset: () => { calls.push('reset'); } } as ToolOptionsFeatureProjection;
    const result = projectToolOptions(shared, null, () => { calls.push('close'); });
    result.toolbar.onWarpReset(); expect(calls).toEqual(['reset']);
    result.contextMenu.onWarpReset(); expect(calls).toEqual(['reset', 'reset', 'close']);
    expect(shared.onWarpReset).toBe(result.toolbar.onWarpReset);
  });

  it('preserves a throwing Reset without manufacturing menu closure', () => {
    const close = vi.fn();
    const shared = { onWarpReset: () => { throw new Error('Reset failed'); } } as unknown as ToolOptionsFeatureProjection;
    expect(() => projectToolOptions(shared, null, close).contextMenu.onWarpReset()).toThrow('Reset failed');
    expect(close).not.toHaveBeenCalled();
  });
});
