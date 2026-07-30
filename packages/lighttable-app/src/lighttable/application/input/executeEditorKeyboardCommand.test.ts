import { describe, expect, it, vi } from 'vitest';
import type { ToolId } from '../../editor/session/editorSession';
import {
  executeEditorKeyboardCommand,
  type EditorKeyboardCommandPorts
} from './executeEditorKeyboardCommand';

const ports = (): EditorKeyboardCommandPorts => ({
  isTransformActive: vi.fn(() => false),
  commitTransform: vi.fn(),
  activateTool: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  beginTemporaryPan: vi.fn(),
  fillForeground: vi.fn(),
  fillBackground: vi.fn(),
  selectAll: vi.fn(),
  selectNone: vi.fn(),
  invertSelection: vi.fn(),
  copySelection: vi.fn(),
  pasteSelection: vi.fn(),
  layerViaCopy: vi.fn(),
  invertActiveTarget: vi.fn(),
  openSelectionFeather: vi.fn(),
  swapColors: vi.fn(),
  toggleOriginal: vi.fn(),
  changeBrushSize: vi.fn(),
  cancelOrClose: vi.fn()
});

describe('executeEditorKeyboardCommand', () => {
  it('commits an active transform before switching to another tool', () => {
    const target = ports();
    target.isTransformActive = vi.fn(() => true);

    executeEditorKeyboardCommand(
      { type: 'activate-tool', tool: 'paint' as ToolId },
      target
    );

    expect(target.commitTransform).toHaveBeenCalledOnce();
    expect(target.activateTool).toHaveBeenCalledWith('paint');
  });

  it('does not commit when the transform tool is reactivated', () => {
    const target = ports();
    target.isTransformActive = vi.fn(() => true);

    executeEditorKeyboardCommand(
      { type: 'activate-tool', tool: 'transform' },
      target
    );

    expect(target.commitTransform).not.toHaveBeenCalled();
    expect(target.activateTool).toHaveBeenCalledWith('transform');
  });

  it('keeps command parameters explicit', () => {
    const target = ports();

    executeEditorKeyboardCommand('brush-size-decrease', target);
    executeEditorKeyboardCommand('fill-background', target);

    expect(target.changeBrushSize).toHaveBeenCalledWith(-1);
    expect(target.fillBackground).toHaveBeenCalledOnce();
  });
});
