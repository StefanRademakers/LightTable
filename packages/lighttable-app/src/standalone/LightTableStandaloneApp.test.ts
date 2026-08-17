import { describe, expect, it } from 'vitest';
import type { LightTableRecentFile } from '../platform/LightTableHost';
import { recentFilesForLauncher } from './LightTableStandaloneApp';

describe('LightTable launcher recent files', () => {
  it('shows the complete persisted MRU history instead of the compact menu window', () => {
    const recentFiles: LightTableRecentFile[] = Array.from(
      { length: 17 },
      (_, index) => ({ id: `recent-${index}`, name: `Recent ${index}.lighttable`, available: true })
    );

    expect(recentFilesForLauncher(recentFiles)).toEqual(recentFiles);
    expect(recentFilesForLauncher(recentFiles)[0]?.id).toBe('recent-0');
  });
});
