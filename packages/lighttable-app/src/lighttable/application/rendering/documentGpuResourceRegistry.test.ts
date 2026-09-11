import { describe, expect, it, vi } from 'vitest';
import {
  DocumentGpuResourceRegistry,
  type SubmittedResourceOwner
} from './documentGpuResourceRegistry';

const owner = () => ({
  queue: { onSubmittedWorkDone: vi.fn(async () => undefined) }
}) satisfies SubmittedResourceOwner;

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('DocumentGpuResourceRegistry', () => {
  it('releases every device generation exactly once on document close', async () => {
    const registry = new DocumentGpuResourceRegistry();
    const firstOwner = owner();
    const secondOwner = owner();
    const firstRelease = vi.fn();
    const secondRelease = vi.fn();
    registry.bind('document', firstOwner, () => firstRelease);
    registry.bind('document', secondOwner, () => secondRelease);

    expect(registry.releaseDocument('document')).toBe(true);
    expect(registry.releaseDocument('document')).toBe(false);
    await settle();
    expect(firstRelease).toHaveBeenCalledOnce();
    expect(secondRelease).toHaveBeenCalledOnce();
  });

  it('releases a lost device across documents without touching replacements', async () => {
    const registry = new DocumentGpuResourceRegistry();
    const lostOwner = owner();
    const replacementOwner = owner();
    const lostA = vi.fn();
    const lostB = vi.fn();
    const replacement = vi.fn();
    registry.bind('a', lostOwner, () => lostA);
    registry.bind('b', lostOwner, () => lostB);
    registry.bind('a', replacementOwner, () => replacement);

    expect(registry.releaseOwner(lostOwner)).toBe(2);
    await settle();
    expect(lostA).toHaveBeenCalledOnce();
    expect(lostB).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
    expect(registry.has('a', replacementOwner)).toBe(true);
  });

  it('replaces the release authority for the same document/device binding', async () => {
    const registry = new DocumentGpuResourceRegistry();
    const deviceOwner = owner();
    const stale = vi.fn();
    const current = vi.fn();
    registry.bind('document', deviceOwner, () => stale);
    registry.bind('document', deviceOwner, () => current);

    registry.releaseDocument('document');
    await settle();
    expect(stale).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledOnce();
  });

  it('attempts all releases and reports cleanup failure without skipping peers', async () => {
    const reportReleaseError = vi.fn();
    const registry = new DocumentGpuResourceRegistry(reportReleaseError);
    const completed = vi.fn();
    registry.bind('document', owner(), () => () => { throw new Error('first'); });
    registry.bind('document', owner(), () => completed);

    expect(registry.releaseDocument('document')).toBe(true);
    await settle();
    expect(completed).toHaveBeenCalledOnce();
    expect(reportReleaseError).toHaveBeenCalledOnce();
    expect(registry.has('document')).toBe(false);
  });

  it('does not destroy a resource before submitted work has retired', async () => {
    let complete!: () => void;
    const submitted = new Promise<void>((resolve) => { complete = resolve; });
    const deviceOwner = {
      queue: { onSubmittedWorkDone: vi.fn(() => submitted) }
    } satisfies SubmittedResourceOwner;
    const release = vi.fn();
    const registry = new DocumentGpuResourceRegistry();
    const detach = vi.fn(() => release);
    registry.bind('document', deviceOwner, detach);

    registry.releaseDocument('document');
    expect(detach).toHaveBeenCalledOnce();
    await settle();
    expect(release).not.toHaveBeenCalled();
    complete();
    await settle();
    expect(release).toHaveBeenCalledOnce();
  });
});
