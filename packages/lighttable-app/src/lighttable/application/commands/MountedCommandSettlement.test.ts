import { describe, expect, it, vi } from 'vitest';
import type { DocumentSession } from '../documents/documentSession';
import type { FileTextCreationPrerequisite } from './DocumentCommandExecutionQueue';
import { MountedCommandSettlement } from './MountedCommandSettlement';

describe('MountedCommandSettlement', () => {
  const session = {} as DocumentSession;
  const prerequisite = {} as FileTextCreationPrerequisite;

  it('keeps viewport-only commands outside document settlement', async () => {
    const settleInteraction = vi.fn();
    const prepareForCommand = vi.fn();
    const owner = new MountedCommandSettlement({
      session,
      files: { prepareForCommand },
      settleInteraction
    });

    await owner.settle('view.setZoom');

    expect(settleInteraction).not.toHaveBeenCalled();
    expect(prepareForCommand).not.toHaveBeenCalled();
  });

  it('routes file commands through their captured text prerequisite', async () => {
    const settleInteraction = vi.fn();
    const prepareForCommand = vi.fn();
    const owner = new MountedCommandSettlement({
      session,
      files: { prepareForCommand },
      settleInteraction
    });

    await owner.settle('file.exportPng', prerequisite);

    expect(prepareForCommand).toHaveBeenCalledExactlyOnceWith(session, prerequisite);
    expect(settleInteraction).not.toHaveBeenCalled();
  });

  it('routes semantic document commands through mounted interaction settlement', async () => {
    const settleInteraction = vi.fn();
    const owner = new MountedCommandSettlement({
      session,
      files: { prepareForCommand: vi.fn() },
      settleInteraction
    });

    await owner.settle('selection.modify');

    expect(settleInteraction).toHaveBeenCalledOnce();
  });
});
