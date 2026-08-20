import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS } from '../../editor/tools/toolRegistry';
import { TOOL_AUTOMATION_CATALOG } from './toolAutomationCatalog';

describe('toolAutomationCatalog', () => {
  it('classifies every registered toolbar tool exactly once', () => {
    expect(Object.keys(TOOL_AUTOMATION_CATALOG).sort())
      .toEqual(TOOL_DEFINITIONS.map(({ id }) => id).sort());
  });

  it('does not mislabel owner-only or playback-only tools as complete UI coverage', () => {
    expect(TOOL_AUTOMATION_CATALOG.brush.availability).toBe('playback-command-only');
    expect(TOOL_AUTOMATION_CATALOG.warp.availability).toBe('canonical-owner-only');
    expect(TOOL_AUTOMATION_CATALOG['text-point'].availability).toBe('ui-and-command');
  });
});
