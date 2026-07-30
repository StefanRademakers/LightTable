import { describe, expect, it } from 'vitest';
import type { ToolId } from '../../editor/session/editorSession';
import {
  resolveViewportPointerDownIntent,
  resolveViewportPointerEndIntent,
  resolveViewportPointerMoveIntent,
  type ViewportPointerDownContext,
  type ViewportPointerMoveContext
} from './viewportPointerRouter';

const down = (
  patch: Partial<ViewportPointerDownContext> = {}
): ViewportPointerDownContext => ({
  activeTool: 'view',
  temporaryPan: false,
  focusPickerActive: false,
  primaryButton: true,
  hasMetadata: true,
  hasDocument: true,
  hasDocumentPoint: true,
  hasPaintTarget: true,
  ...patch
});

const move = (
  patch: Partial<ViewportPointerMoveContext> = {}
): ViewportPointerMoveContext => ({
  activeTool: 'view',
  temporaryPan: false,
  panGestureMatches: false,
  selectionGestureMatches: false,
  paintGestureMatches: false,
  hasDocumentPoint: true,
  hasPaintTarget: true,
  hasStrokeBuilder: true,
  ...patch
});

describe('resolveViewportPointerDownIntent', () => {
  it.each<ToolId>([
    'view',
    'zoom',
    'transform',
    'fill',
    'brush',
    'erase',
    'select-rectangle'
  ])('gives temporary pan precedence over %s', (activeTool) => {
    expect(resolveViewportPointerDownIntent(down({
      activeTool,
      temporaryPan: true,
      primaryButton: false
    }))).toBe('temporary-pan');
  });

  it('keeps focus picking on the view controller', () => {
    expect(resolveViewportPointerDownIntent(down({
      activeTool: 'select-rectangle',
      focusPickerActive: true
    }))).toBe('view');
    expect(resolveViewportPointerDownIntent(down({
      activeTool: 'fill',
      focusPickerActive: true
    }))).toBe('view');
    expect(resolveViewportPointerDownIntent(down({
      activeTool: 'brush',
      focusPickerActive: true
    }))).toBe('view');
  });

  it('requires a primary, projected pointer for selection and fill', () => {
    expect(resolveViewportPointerDownIntent(down({
      activeTool: 'select-free'
    }))).toBe('selection');
    expect(resolveViewportPointerDownIntent(down({
      activeTool: 'select-free',
      hasMetadata: false
    }))).toBe('ignore');
    expect(resolveViewportPointerDownIntent(down({
      activeTool: 'fill',
      primaryButton: false
    }))).toBe('ignore');
  });

  it('only starts paint with a document, projected point and editable target', () => {
    expect(resolveViewportPointerDownIntent(down({ activeTool: 'erase' }))).toBe('paint');
    expect(resolveViewportPointerDownIntent(down({
      activeTool: 'brush',
      hasPaintTarget: false
    }))).toBe('ignore');
    expect(resolveViewportPointerDownIntent(down({
      activeTool: 'brush',
      hasDocument: false
    }))).toBe('ignore');
  });
});

describe('resolveViewportPointerMoveIntent', () => {
  it('retains the controller that owns an active gesture', () => {
    expect(resolveViewportPointerMoveIntent(move({
      activeTool: 'brush',
      panGestureMatches: true,
      paintGestureMatches: true
    }))).toBe('pan');
    expect(resolveViewportPointerMoveIntent(move({
      activeTool: 'brush',
      selectionGestureMatches: true,
      paintGestureMatches: true
    }))).toBe('selection');
    expect(resolveViewportPointerMoveIntent(move({
      activeTool: 'brush',
      paintGestureMatches: true
    }))).toBe('paint');
  });

  it('does not paint without a complete gesture context', () => {
    expect(resolveViewportPointerMoveIntent(move({
      activeTool: 'brush',
      paintGestureMatches: true,
      hasStrokeBuilder: false
    }))).toBe('ignore');
  });

  it('routes non-paint hover movement through the view controller', () => {
    expect(resolveViewportPointerMoveIntent(move({
      activeTool: 'select-ellipse'
    }))).toBe('pan');
  });
});

describe('resolveViewportPointerEndIntent', () => {
  it('ends selection before paint and otherwise ends pan', () => {
    expect(resolveViewportPointerEndIntent({
      selectionGestureMatches: true,
      paintGestureMatches: true
    })).toBe('selection');
    expect(resolveViewportPointerEndIntent({
      selectionGestureMatches: false,
      paintGestureMatches: true
    })).toBe('paint');
    expect(resolveViewportPointerEndIntent({
      selectionGestureMatches: false,
      paintGestureMatches: false
    })).toBe('pan');
  });
});
