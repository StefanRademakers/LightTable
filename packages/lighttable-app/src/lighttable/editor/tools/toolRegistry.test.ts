import { describe, expect, it } from 'vitest';
import type { ToolId } from '../session/editorSession';
import {
  SELECTION_TOOL_DEFINITIONS,
  FILL_TOOL_DEFINITIONS,
  PEN_TOOL_DEFINITIONS,
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
      'select-magic-wand',
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
  it('defines pen and anchor editing as one toolbar family', () => {
    expect(PEN_TOOL_DEFINITIONS.map(({ id }) => id)).toEqual([
      'vector-pen',
      'vector-add-anchor',
      'vector-delete-anchor',
      'vector-convert-anchor'
    ]);
  });
  it('keeps point/paragraph gesture-derived and exposes horizontal, vertical and Path modes', () => {
    expect(TEXT_TOOL_DEFINITIONS.map(({ id }) => id)).toEqual([
      'text-point', 'text-vertical', 'text-path'
    ]);
  });
  it('defines Gradient and Paint Bucket as one toolbar family', () => {
    expect(FILL_TOOL_DEFINITIONS.map(({ id }) => id)).toEqual(['fill', 'gradient']);
  });
  it('defines every editor tool exactly once', () => {
    const expected: ToolId[] = [
      'view',
      'zoom',
      'transform',
      'warp',
      'gradient',
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
      'text-vertical',
      'text-path',
      'select-rectangle',
      'select-ellipse',
      'select-horizontal',
      'select-vertical',
      'select-free',
      'select-polygonal',
      'select-magic-wand'
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
    expect(toolForShortcutCycle('g', 'view', false)).toBe('gradient');
    expect(toolForShortcutCycle('g', 'gradient', false)).toBe('fill');
    expect(toolForShortcutCycle('g', 'fill', true)).toBe('gradient');
  });

  it('resolves modifier-sensitive shortcuts', () => {
    expect(toolForShortcut('m', false)).toBe('select-rectangle');
    expect(toolForShortcut('M', true)).toBe('select-ellipse');
    expect(toolForShortcut('l', false)).toBe('select-free');
    expect(toolForShortcut('L', true)).toBe('select-polygonal');
    expect(toolForShortcut('b', false)).toBe('brush');
    expect(toolForShortcut('b', true)).toBe('brush');
    expect(toolForShortcut('v', false)).toBe('transform');
    expect(toolForShortcut('w', false)).toBe('select-magic-wand');
    expect(toolDefinition('warp').shortcutKey).toBeUndefined();
    expect(toolForShortcut('z', false)).toBe('zoom');
    expect(toolForShortcutCycle('g', 'view', false)).toBe('gradient');
    expect(toolForShortcut('a', false)).toBe('vector-select');
    expect(toolForShortcut('A', true)).toBe('vector-direct-select');
    expect(toolForShortcut('p', false)).toBe('vector-pen');
    expect(toolForShortcut('u', false)).toBe('shape-rectangle');
    expect(toolForShortcut('U', true)).toBe('shape-ellipse');
    expect(toolForShortcutCycle('t', 'view', false)).toBe('text-point');
    expect(toolForShortcutCycle('t', 'text-point', true)).toBe('text-vertical');
    expect(toolForShortcutCycle('t', 'text-vertical', true)).toBe('text-point');
    expect(toolForShortcutCycle('t', 'text-paragraph', false)).toBe('text-point');
    expect(toolForShortcutCycle('t', 'text-path', false)).toBe('text-point');
  });

  it('keeps visible vector tools without dedicated shortcuts out of key dispatch', () => {
    expect(toolDefinition('vector-add-anchor').shortcutKey).toBeUndefined();
    expect(toolDefinition('shape-line').shortcutKey).toBeUndefined();
  });

  it('uses the dedicated Path Text artwork instead of the generic Type icon', () => {
    expect(toolDefinition('text-path').iconName).toBe('tool_text_on_path.png');
    expect(toolDefinition('text-path').iconName).not.toBe(toolDefinition('text-point').iconName);
  });

  it('uses the dedicated vertical Type artwork', () => {
    expect(toolDefinition('text-vertical').iconName).toBe('tool_text_vertical.png');
    expect(toolDefinition('text-vertical').iconName).not.toBe(toolDefinition('text-point').iconName);
  });

  it('exposes stable capabilities and presentation metadata', () => {
    expect(toolDefinition('erase')).toMatchObject({
      role: 'paint',
      iconName: 'erase.png',
      shortcutLabel: 'E'
    });
  });
});
