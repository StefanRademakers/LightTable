import { describe, expect, it } from 'vitest';
import type { ToolId } from '../session/editorSession';
import {
  SELECTION_TOOL_DEFINITIONS,
  SHAPE_TOOL_DEFINITIONS,
  TEXT_TOOL_DEFINITIONS,
  TOOL_DEFINITIONS,
  toolDefinition,
  toolForShortcut,
  toolForShortcutCycle
} from './toolRegistry';

describe('toolRegistry', () => {
  it('defines all selection tools as one toolbar family', () => {
    expect(SELECTION_TOOL_DEFINITIONS.map(({ id }) => id)).toEqual([
      'select-rectangle',
      'select-ellipse',
      'select-free',
      'select-polygonal',
      'select-horizontal',
      'select-vertical'
    ]);
  });
  it('defines the four live-shape tools as one toolbar family', () => {
    expect(SHAPE_TOOL_DEFINITIONS.map(({ id }) => id)).toEqual([
      'shape-rectangle',
      'shape-ellipse',
      'shape-triangle',
      'shape-line'
    ]);
  });
  it('defines point and paragraph text as one toolbar family', () => {
    expect(TEXT_TOOL_DEFINITIONS.map(({ id }) => id)).toEqual(['text-point', 'text-paragraph']);
  });
  it('defines every editor tool exactly once', () => {
    const expected: ToolId[] = [
      'view',
      'zoom',
      'transform',
      'warp',
      'fill',
      'brush',
      'erase',
      'vector-select',
      'vector-direct-select',
      'vector-pen',
      'vector-add-anchor',
      'vector-delete-anchor',
      'vector-convert-anchor',
      'shape-rectangle',
      'shape-ellipse',
      'shape-triangle',
      'shape-line',
      'text-point',
      'text-paragraph',
      'select-rectangle',
      'select-ellipse',
      'select-horizontal',
      'select-vertical',
      'select-free',
      'select-polygonal'
    ];
    expect(new Set(TOOL_DEFINITIONS.map(({ id }) => id))).toEqual(new Set(expected));
    expect(TOOL_DEFINITIONS).toHaveLength(expected.length);
  });

  it('cycles Photoshop-style vector tool groups without leaking state', () => {
    expect(toolForShortcutCycle('a', 'view', false)).toBe('vector-select');
    expect(toolForShortcutCycle('a', 'vector-select', false)).toBe('vector-direct-select');
    expect(toolForShortcutCycle('a', 'vector-direct-select', true)).toBe('vector-select');
    expect(toolForShortcutCycle('u', 'view', true)).toBe('shape-ellipse');
    expect(toolForShortcutCycle('u', 'shape-ellipse', false)).toBe('shape-triangle');
    expect(toolForShortcutCycle('p', 'vector-pen', false)).toBe('vector-add-anchor');
    expect(toolForShortcutCycle('p', 'vector-pen', true)).toBe('vector-convert-anchor');
  });

  it('resolves modifier-sensitive shortcuts', () => {
    expect(toolForShortcut('m', false)).toBe('select-rectangle');
    expect(toolForShortcut('M', true)).toBe('select-ellipse');
    expect(toolForShortcut('l', false)).toBe('select-free');
    expect(toolForShortcut('L', true)).toBe('select-polygonal');
    expect(toolForShortcut('b', false)).toBe('brush');
    expect(toolForShortcut('b', true)).toBe('brush');
    expect(toolForShortcut('v', false)).toBe('transform');
    expect(toolForShortcut('w', false)).toBe('warp');
    expect(toolForShortcut('z', false)).toBe('zoom');
    expect(toolForShortcut('a', false)).toBe('vector-select');
    expect(toolForShortcut('A', true)).toBe('vector-direct-select');
    expect(toolForShortcut('p', false)).toBe('vector-pen');
    expect(toolForShortcut('u', false)).toBe('shape-rectangle');
    expect(toolForShortcut('U', true)).toBe('shape-ellipse');
    expect(toolForShortcutCycle('t', 'view', false)).toBe('text-point');
    expect(toolForShortcutCycle('t', 'text-point', true)).toBe('text-paragraph');
  });

  it('keeps visible vector tools without dedicated shortcuts out of key dispatch', () => {
    expect(toolDefinition('vector-add-anchor').shortcutKey).toBeUndefined();
    expect(toolDefinition('shape-line').shortcutKey).toBeUndefined();
  });

  it('exposes stable capabilities and presentation metadata', () => {
    expect(toolDefinition('erase')).toMatchObject({
      role: 'paint',
      iconName: 'erase.png',
      shortcutLabel: 'E'
    });
  });
});
