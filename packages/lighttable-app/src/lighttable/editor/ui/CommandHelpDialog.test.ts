import { describe, expect, it } from 'vitest';
import { LIGHTTABLE_COMMAND_HELP } from './CommandHelpDialog';

describe('command help catalog', () => {
  it('surfaces the core Photoshop-compatible first-session shortcuts', () => {
    const entries = new Map(LIGHTTABLE_COMMAND_HELP.map(([name, shortcut]) => [name, shortcut]));
    expect(entries.get('Open')).toBe('Ctrl+O');
    expect(entries.get('Save')).toBe('Ctrl+S');
    expect(entries.get('Undo')).toBe('Ctrl+Z');
    expect(entries.get('Text')).toBe('T');
    expect(entries.get('Quick export PNG')).toBe('Ctrl+Alt+Shift+W');
  });
});
