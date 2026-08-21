import { describe, expect, it } from 'vitest';
import { squirrelEventFromArgv } from './squirrelStartup';

describe('Squirrel startup event detection', () => {
  it.each([
    '--squirrel-install', '--squirrel-updated', '--squirrel-uninstall', '--squirrel-obsolete'
  ] as const)('recognizes %s in the Squirrel argument position', (event) => {
    expect(squirrelEventFromArgv(['LightTable.exe', event, '0.1.0-alpha1'])).toBe(event);
  });

  it('does not treat normal file launches or first-run as lifecycle events', () => {
    expect(squirrelEventFromArgv(['LightTable.exe', 'C:\\Images\\photo.png'])).toBeNull();
    expect(squirrelEventFromArgv(['LightTable.exe', '--squirrel-firstrun'])).toBeNull();
  });
});
