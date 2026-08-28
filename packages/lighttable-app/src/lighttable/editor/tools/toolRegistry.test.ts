import { describe, expect, it } from 'vitest';
import type { ToolId } from '../session/editorSession';
import {
  FILL_TOOL_DEFINITIONS,
  LASSO_TOOL_DEFINITIONS,
  MARQUEE_TOOL_DEFINITIONS,
  PATH_SELECTION_TOOL_DEFINITIONS,
  PEN_TOOL_DEFINITIONS,
  SHAPE_TOOL_DEFINITIONS,
  SMART_SELECTION_TOOL_DEFINITIONS,
  TEXT_TOOL_DEFINITIONS,
  TONE_TOOL_DEFINITIONS,
  TOOL_DEFINITIONS,
  toolbarToolDefinitions,
  toolDefinition,
  toolForShortcutFamily,
  toolShortcutGroupFor
} from './toolRegistry';

describe('toolRegistry', () => {
  it('uses Photoshop-compatible M, L and W selection families', () => {
    expect(MARQUEE_TOOL_DEFINITIONS.map(({ id }) => id)).toEqual([
      'select-rectangle',
      'select-ellipse',
      'select-horizontal',
      'select-vertical'
    ]);
    expect(LASSO_TOOL_DEFINITIONS.map(({ id }) => id)).toEqual([
      'select-free',
      'select-polygonal'
    ]);
    expect(SMART_SELECTION_TOOL_DEFINITIONS.map(({ id }) => id)).toEqual([
      'select-magic-wand', 'select-paint-brush', 'select-object'
    ]);
    expect(toolShortcutGroupFor('select-magic-wand')?.key).toBe('w');
    expect(toolDefinition('select-magic-wand').shortcutKey).toBe('w');
    expect(toolDefinition('select-object').iconName).toBe('tool_object_selection.png');
    expect(toolForShortcutFamily('w', 'select-magic-wand', true)).toBe('select-paint-brush');
    expect(toolForShortcutFamily('w', 'select-paint-brush', true)).toBe('select-object');
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
  it('defines whole-path and direct selection as one A family', () => {
    expect(PATH_SELECTION_TOOL_DEFINITIONS.map(({ id }) => id)).toEqual([
      'vector-select', 'vector-direct-select'
    ]);
  });
  it('keeps point/paragraph gesture-derived and exposes horizontal, vertical and Path modes', () => {
    expect(TEXT_TOOL_DEFINITIONS.map(({ id }) => id)).toEqual([
      'text-point', 'text-vertical', 'text-path'
    ]);
  });
  it('defines Gradient and Paint Bucket as one toolbar family', () => {
    expect(FILL_TOOL_DEFINITIONS.map(({ id }) => id)).toEqual(['gradient', 'fill']);
  });
  it('defines Dodge, Burn and Sponge as Photoshop-compatible O tools', () => {
    expect(TONE_TOOL_DEFINITIONS.map(({ id }) => id)).toEqual(['dodge', 'burn', 'sponge']);
    expect(toolForShortcutFamily('o', 'dodge', true)).toBe('burn');
    expect(toolForShortcutFamily('o', 'burn', true)).toBe('sponge');
  });
  it('defines every editor tool exactly once', () => {
    const expected: ToolId[] = [
      'view',
      'zoom',
      'transform',
      'warp',
      'face-warp',
      'gradient',
      'fill',
      'brush',
      'healing-brush',
      'clone-stamp',
      'erase',
      'dodge',
      'burn',
      'sponge',
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
      'select-object',
      'select-magic-wand',
      'select-paint-brush'
    ];
    expect(new Set(TOOL_DEFINITIONS.map(({ id }) => id))).toEqual(new Set(expected));
    expect(TOOL_DEFINITIONS).toHaveLength(expected.length);
  });

  it('keeps experimental tools testable without presenting them as release-ready', () => {
    expect(toolbarToolDefinitions(false).some(({ id }) => id === 'face-warp')).toBe(false);
    expect(toolbarToolDefinitions(true).some(({ id }) => id === 'face-warp')).toBe(true);
    expect(toolDefinition('face-warp').experimental).toBe(true);
  });

  it('restores a family preference with the plain key and advances with Shift', () => {
    expect(toolForShortcutFamily('a', 'view', false)).toBe('vector-select');
    expect(toolForShortcutFamily('a', 'vector-select', false)).toBe('vector-select');
    expect(toolForShortcutFamily('a', 'vector-select', true)).toBe('vector-direct-select');
    expect(toolForShortcutFamily('a', 'vector-direct-select', true)).toBe('vector-select');
    expect(toolForShortcutFamily('u', 'shape-ellipse', false)).toBe('shape-ellipse');
    expect(toolForShortcutFamily('u', 'shape-ellipse', true)).toBe('shape-triangle');
    expect(toolForShortcutFamily('p', 'vector-pen', false)).toBe('vector-pen');
    expect(toolForShortcutFamily('p', 'vector-pen', true)).toBe('vector-add-anchor');
    expect(toolForShortcutFamily('g', 'view', false)).toBe('gradient');
    expect(toolForShortcutFamily('g', 'gradient', false)).toBe('gradient');
    expect(toolForShortcutFamily('g', 'gradient', true)).toBe('fill');
    expect(toolForShortcutFamily('g', 'fill', true)).toBe('gradient');
  });

  it('exposes Photoshop-compatible shortcut families', () => {
    expect(toolShortcutGroupFor('select-rectangle')?.key).toBe('m');
    expect(toolShortcutGroupFor('select-free')?.key).toBe('l');
    expect(toolShortcutGroupFor('select-magic-wand')?.key).toBe('w');
    expect(toolShortcutGroupFor('vector-select')?.key).toBe('a');
    expect(toolShortcutGroupFor('vector-pen')?.key).toBe('p');
    expect(toolShortcutGroupFor('shape-rectangle')?.key).toBe('u');
    expect(toolShortcutGroupFor('text-point')?.key).toBe('t');
    expect(toolShortcutGroupFor('gradient')?.key).toBe('g');
    expect(toolShortcutGroupFor('dodge')?.key).toBe('o');
    expect(toolDefinition('warp').shortcutKey).toBeUndefined();
    expect(toolForShortcutFamily('t', 'view', false)).toBe('text-point');
    expect(toolForShortcutFamily('t', 'text-point', true)).toBe('text-vertical');
    expect(toolForShortcutFamily('t', 'text-vertical', true)).toBe('text-path');
    expect(toolForShortcutFamily('t', 'text-path', true)).toBe('text-point');
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
