import { describe, expect, it, vi } from 'vitest';
import type { ToolId } from '../../editor/session/editorSession';
import {
  executeEditorKeyboardCommand,
  type EditorKeyboardCommandPorts
} from './executeEditorKeyboardCommand';

const ports = (): EditorKeyboardCommandPorts => ({
  openFile: vi.fn(),
  saveFile: vi.fn(),
  quickExportPng: vi.fn(),
  openImageSize: vi.fn(),
  isTransformActive: vi.fn(() => false),
  commitTransform: vi.fn(),
  repeatTransform: vi.fn(),
  commitActiveOperation: vi.fn(),
  activateTool: vi.fn(),
  undo: vi.fn(),
  undoPenAnchor: vi.fn(() => false),
  redo: vi.fn(),
  beginTemporaryPan: vi.fn(),
  beginTemporaryZoom: vi.fn(),
  beginTemporaryErase: vi.fn(),
  fillForeground: vi.fn(),
  fillBackground: vi.fn(),
  openFillDialog: vi.fn(),
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
  resetColors: vi.fn(),
  toggleOriginal: vi.fn(),
  toggleScreenMode: vi.fn(),
  changeBrushSize: vi.fn(),
  changeBrushHardness: vi.fn(),
  openBrushSettings: vi.fn(),
  inputBrushPercent: vi.fn(),
  nudge: vi.fn(),
  activateAdjacentDocument: vi.fn(),
  closeActiveDocument: vi.fn(),
  changeZoom: vi.fn(),
  fitZoom: vi.fn(),
  actualZoom: vi.fn(),
  cancelOrClose: vi.fn()
});

describe('executeEditorKeyboardCommand', () => {
  it('undoes a provisional Pen anchor before document history', () => {
    const target = ports();
    target.undoPenAnchor = vi.fn(() => true);
    executeEditorKeyboardCommand('undo', target);
    expect(target.undoPenAnchor).toHaveBeenCalledOnce();
    expect(target.undo).not.toHaveBeenCalled();
  });

  it('routes Enter to the active Pen path transaction', () => {
    const target = ports();
    executeEditorKeyboardCommand('commit-active-operation', target);
    expect(target.commitActiveOperation).toHaveBeenCalledOnce();
  });

  it('routes repeat and repeat-duplicate transforms independently', () => {
    const target = ports();
    executeEditorKeyboardCommand('repeat-transform', target);
    executeEditorKeyboardCommand('repeat-transform-duplicate', target);
    expect(target.repeatTransform).toHaveBeenNthCalledWith(1, false);
    expect(target.repeatTransform).toHaveBeenNthCalledWith(2, true);
  });

  it('routes file commands through the active editor file ports', () => {
    const target = ports();

    executeEditorKeyboardCommand('open-file', target);
    executeEditorKeyboardCommand('save-file', target);
    executeEditorKeyboardCommand('quick-export-png', target);

    expect(target.openFile).toHaveBeenCalledOnce();
    expect(target.saveFile).toHaveBeenCalledOnce();
    expect(target.quickExportPng).toHaveBeenCalledOnce();
  });

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

  it('routes transparency-preserving fills and the Fill dialog explicitly', () => {
    const target = ports();

    executeEditorKeyboardCommand('fill-foreground-preserve', target);
    executeEditorKeyboardCommand('fill-background-preserve', target);
    executeEditorKeyboardCommand('open-fill-dialog', target);

    expect(target.fillForeground).toHaveBeenCalledWith(true);
    expect(target.fillBackground).toHaveBeenCalledWith(true);
    expect(target.openFillDialog).toHaveBeenCalledOnce();
  });

  it('opens the shared Brush settings surface', () => {
    const target = ports();

    executeEditorKeyboardCommand('open-brush-settings', target);

    expect(target.openBrushSettings).toHaveBeenCalledOnce();
  });

  it('routes workspace and layer commands through explicit ports', () => {
    const target = ports();

    executeEditorKeyboardCommand('merge-down', target);
    executeEditorKeyboardCommand('activate-previous-document', target);
    executeEditorKeyboardCommand('close-active-document', target);
    executeEditorKeyboardCommand('toggle-screen-mode', target);

    expect(target.mergeDown).toHaveBeenCalledOnce();
    expect(target.activateAdjacentDocument).toHaveBeenCalledWith(-1);
    expect(target.closeActiveDocument).toHaveBeenCalledOnce();
    expect(target.toggleScreenMode).toHaveBeenCalledOnce();
  });

  it('routes browser zoom chords to the active document viewport', () => {
    const target = ports();

    executeEditorKeyboardCommand('zoom-in', target);
    executeEditorKeyboardCommand('zoom-out', target);
    executeEditorKeyboardCommand('zoom-fit', target);
    executeEditorKeyboardCommand('zoom-actual', target);

    expect(target.changeZoom).toHaveBeenNthCalledWith(1, 1);
    expect(target.changeZoom).toHaveBeenNthCalledWith(2, -1);
    expect(target.fitZoom).toHaveBeenCalledOnce();
    expect(target.actualZoom).toHaveBeenCalledOnce();
  });

  it('routes temporary zoom direction explicitly', () => {
    const target = ports();
    executeEditorKeyboardCommand('temporary-zoom-in-start', target);
    executeEditorKeyboardCommand('temporary-zoom-out-start', target);
    expect(target.beginTemporaryZoom).toHaveBeenNthCalledWith(1, 1);
    expect(target.beginTemporaryZoom).toHaveBeenNthCalledWith(2, -1);
  });
});
