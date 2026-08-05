import { describe, expect, it } from 'vitest';
import type { LightTableRecentFile } from '../platform/LightTableHost';
import { recentFilesForLauncher } from './LightTableStandaloneApp';

describe('LightTable launcher recent files', () => {
  it('uses the same fifteen-entry MRU window as Open Recent', () => {
    const recentFiles: LightTableRecentFile[] = Array.from(
      { length: 17 },
      (_, index) => ({ id: `recent-${index}`, name: `Recent ${index}.lighttable` })
    );

    expect(recentFilesForLauncher(recentFiles)).toEqual(recentFiles.slice(0, 15));
    expect(recentFilesForLauncher(recentFiles)[0]?.id).toBe('recent-0');
  });
});
