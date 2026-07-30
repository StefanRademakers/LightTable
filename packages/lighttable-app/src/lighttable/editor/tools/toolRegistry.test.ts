import { describe, expect, it } from 'vitest';
import type { ToolId } from '../session/editorSession';
import { TOOL_DEFINITIONS, toolDefinition, toolForShortcut } from './toolRegistry';

describe('toolRegistry', () => {
  it('defines every editor tool exactly once', () => {
    const expected: ToolId[] = [
      'view',
      'transform',
      'fill',
      'brush',
      'erase',
      'select-rectangle',
      'select-ellipse',
      'select-free'
    ];
    expect(new Set(TOOL_DEFINITIONS.map(({ id }) => id))).toEqual(new Set(expected));
    expect(TOOL_DEFINITIONS).toHaveLength(expected.length);
  });

  it('resolves modifier-sensitive shortcuts', () => {
    expect(toolForShortcut('m', false)).toBe('select-rectangle');
    expect(toolForShortcut('M', true)).toBe('select-ellipse');
    expect(toolForShortcut('b', false)).toBe('brush');
    expect(toolForShortcut('b', true)).toBe('brush');
  });

  it('exposes stable capabilities and presentation metadata', () => {
    expect(toolDefinition('erase')).toMatchObject({
      role: 'paint',
      iconName: 'erase.png',
      shortcutLabel: 'E'
    });
  });
});
