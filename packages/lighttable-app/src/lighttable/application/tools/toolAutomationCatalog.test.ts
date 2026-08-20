import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS } from '../../editor/tools/toolRegistry';
import { TOOL_AUTOMATION_CATALOG } from './toolAutomationCatalog';

describe('toolAutomationCatalog', () => {
  it('classifies every registered toolbar tool exactly once', () => {
    expect(Object.keys(TOOL_AUTOMATION_CATALOG).sort())
      .toEqual(TOOL_DEFINITIONS.map(({ id }) => id).sort());
  });

  it('distinguishes recorded UI tools from owner-only tools', () => {
    expect(TOOL_AUTOMATION_CATALOG.brush.availability).toBe('ui-and-command');
    expect(TOOL_AUTOMATION_CATALOG.brush.capabilities)
      .toContain('tool.commitGesture:brush-stroke');
    expect(TOOL_AUTOMATION_CATALOG['shape-rectangle'].availability).toBe('ui-and-command');
    expect(TOOL_AUTOMATION_CATALOG['vector-pen'].availability).toBe('ui-and-command');
    expect(TOOL_AUTOMATION_CATALOG['vector-direct-select'].availability).toBe('ui-and-command');
    expect(TOOL_AUTOMATION_CATALOG['vector-add-anchor'].availability).toBe('ui-and-command');
    expect(TOOL_AUTOMATION_CATALOG['vector-delete-anchor'].capabilities).toContain('vector.remove');
    expect(TOOL_AUTOMATION_CATALOG.gradient.availability).toBe('ui-and-command');
    expect(TOOL_AUTOMATION_CATALOG.warp.availability).toBe('canonical-owner-only');
    expect(TOOL_AUTOMATION_CATALOG['text-point'].availability).toBe('ui-and-command');
  });
});
