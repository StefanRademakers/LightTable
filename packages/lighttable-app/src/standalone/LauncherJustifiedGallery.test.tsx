import { describe, expect, it, vi } from 'vitest';
import { launcherGalleryShowsRemoveAction } from './LauncherJustifiedGallery';

describe('LauncherJustifiedGallery', () => {
  it('exposes an explicit recovery discard action without changing normal recents', () => {
    const recovery = {
      id: 'recovery-1', title: 'portrait.png', available: true,
      onOpen: vi.fn(), onRemove: vi.fn(), removeLabel: 'Discard recovery for portrait.png'
    };
    expect(launcherGalleryShowsRemoveAction(recovery)).toBe(true);

    const recent = {
      id: 'recent-1', title: 'portrait.png', available: true,
      onOpen: vi.fn(), onRemove: vi.fn()
    };
    expect(launcherGalleryShowsRemoveAction(recent)).toBe(false);
  });
});
