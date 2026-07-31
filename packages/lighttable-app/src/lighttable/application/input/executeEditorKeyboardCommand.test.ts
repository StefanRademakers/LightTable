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
  copyMergedSelection: vi.fn(),
  pasteSelection: vi.fn(),
  layerViaCopy: vi.fn(),
  mergeDown: vi.fn(),
  invertActiveTarget: vi.fn(),
  openSelectionFeather: vi.fn(),
  swapColors: vi.fn(),
  toggleOriginal: vi.fn(),
  changeBrushSize: vi.fn(),
  activateAdjacentDocument: vi.fn(),
  closeActiveDocument: vi.fn(),
  changeZoom: vi.fn(),
  fitZoom: vi.fn(),
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

  it('routes workspace and layer commands through explicit ports', () => {
    const target = ports();

    executeEditorKeyboardCommand('merge-down', target);
    executeEditorKeyboardCommand('activate-previous-document', target);
    executeEditorKeyboardCommand('close-active-document', target);

    expect(target.mergeDown).toHaveBeenCalledOnce();
    expect(target.activateAdjacentDocument).toHaveBeenCalledWith(-1);
    expect(target.closeActiveDocument).toHaveBeenCalledOnce();
  });

  it('routes browser zoom chords to the active document viewport', () => {
    const target = ports();

    executeEditorKeyboardCommand('zoom-in', target);
    executeEditorKeyboardCommand('zoom-out', target);
    executeEditorKeyboardCommand('zoom-fit', target);

    expect(target.changeZoom).toHaveBeenNthCalledWith(1, 1);
    expect(target.changeZoom).toHaveBeenNthCalledWith(2, -1);
    expect(target.fitZoom).toHaveBeenCalledOnce();
  });
});
