import { describe, expect, it, vi } from 'vitest';
import { createEditorSession, type ToolId } from '../../editor/session/editorSession';
import { PersistentToolActivationOwner, applyPersistentToolPreference, type PersistentToolActivationBinding } from './PersistentToolActivationOwner';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const fixture = (initial: ToolId = 'view') => {
  const events: string[] = [];
  let tool = initial;
  let current = true;
  const record = (name: string) => vi.fn(() => { events.push(name); });
  const binding: PersistentToolActivationBinding = {
    isCurrent: () => current, currentTool: () => tool,
    clearCrop: record('crop'),
    text: {
      invalidatePointCreation: record('invalidate-text'),
      commitPointCreation: record('commit-text'), finishEditing: record('finish-text')
    },
    warp: { isActive: () => true, reset: record('warp') },
    faceWarp: { reset: record('face-warp'), resetDetection: record('detection') },
    transform: {
      isActive: () => false, hasPendingWork: () => false,
      begin: vi.fn(async () => { events.push('begin-transform'); })
    },
    settleInteraction: vi.fn(async () => { events.push('settle'); }),
    selection: { hasDraft: () => false, reset: record('selection') },
    publishTool: vi.fn((next) => { tool = next; events.push(`tool:${next}`); })
  };
  return {
    owner: new PersistentToolActivationOwner(), binding, events,
    readTool: () => tool, setTool: (next: ToolId) => { tool = next; },
    retire: () => { current = false; }
  };
};

describe('PersistentToolActivationOwner', () => {
  it('publishes ordinary switches synchronously and uses fresh tool state', async () => {
    const f = fixture();
    const result = f.owner.activate('brush', f.binding);
    expect(f.readTool()).toBe('brush');
    await f.owner.activate('erase', f.binding);
    expect(f.readTool()).toBe('erase');
    expect(f.binding.settleInteraction).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('activated');
  });

  it('leaves first transform launch to the transform activation lifecycle', async () => {
    const f = fixture();
    await f.owner.activate('transform', f.binding);
    expect(f.readTool()).toBe('transform');
    expect(f.binding.transform.begin).not.toHaveBeenCalled();
  });

  it('waits for active transform before any successor terminals/publication', async () => {
    const f = fixture('transform');
    const gate = deferred();
    f.binding.transform.isActive = () => true;
    f.binding.settleInteraction = () => gate.promise;
    const after = vi.fn();
    const result = f.owner.activate('brush', f.binding, after);
    expect(f.events).toEqual([]);
    expect(after).not.toHaveBeenCalled();
    gate.resolve();
    await expect(result).resolves.toBe('activated');
    expect(f.readTool()).toBe('brush');
    expect(after).toHaveBeenCalledOnce();
  });

  it.each(['pending-launch', 'pending-commit'])('does not confuse %s with dormant transform', async () => {
    const f = fixture('transform');
    f.binding.transform.hasPendingWork = () => true;
    await f.owner.activate('transform', f.binding);
    expect(f.binding.settleInteraction).toHaveBeenCalledOnce();
    expect(f.binding.transform.begin).not.toHaveBeenCalled();
  });

  it('settles an unrealized launch before leaving transform', async () => {
    const f = fixture('transform');
    await f.owner.activate('view', f.binding);
    expect(f.binding.settleInteraction).toHaveBeenCalledOnce();
    expect(f.readTool()).toBe('view');
  });

  it('restarts a genuinely dormant repeat without republishing tool state', async () => {
    const f = fixture('transform');
    await f.owner.activate('transform', f.binding);
    expect(f.binding.transform.begin).toHaveBeenCalledOnce();
    expect(f.binding.publishTool).not.toHaveBeenCalled();
  });

  it('settles temporary selection content movement too', async () => {
    const f = fixture('select-rectangle');
    f.binding.transform.isActive = () => true;
    await f.owner.activate('brush', f.binding);
    expect(f.binding.settleInteraction).toHaveBeenCalledOnce();
  });

  it('waits for a queued selection nudge before its transform has launched', async () => {
    const f = fixture('select-rectangle');
    const gate = deferred();
    f.binding.transform.hasPendingWork = () => true;
    f.binding.settleInteraction = () => gate.promise;
    const pending = f.owner.activate('brush', f.binding);
    expect(f.readTool()).toBe('select-rectangle');
    expect(f.events).toEqual([]);
    gate.resolve();
    await expect(pending).resolves.toBe('activated');
    expect(f.readTool()).toBe('brush');
  });

  it('only applies the last of two requests waiting for settlement', async () => {
    const f = fixture('transform');
    const gate = deferred();
    f.binding.settleInteraction = () => gate.promise;
    const firstAfter = vi.fn();
    const first = f.owner.activate('brush', f.binding, firstAfter);
    const second = f.owner.activate('erase', f.binding);
    gate.resolve();
    await expect(first).resolves.toBe('superseded');
    await expect(second).resolves.toBe('activated');
    expect(f.events.filter((event) => event.startsWith('tool:'))).toEqual(['tool:erase']);
    expect(firstAfter).not.toHaveBeenCalled();
    expect(f.binding.text.finishEditing).toHaveBeenCalledOnce();
  });

  it('transform -> waiting brush -> transform settles without duplicate restart', async () => {
    const f = fixture('transform');
    const gate = deferred();
    f.binding.settleInteraction = () => gate.promise;
    const first = f.owner.activate('brush', f.binding);
    const second = f.owner.activate('transform', f.binding);
    gate.resolve();
    await expect(first).resolves.toBe('superseded');
    await expect(second).resolves.toBe('activated');
    expect(f.binding.transform.begin).not.toHaveBeenCalled();
    expect(f.binding.publishTool).not.toHaveBeenCalled();
  });

  it('propagates admission failure without preparing or publishing the successor', async () => {
    const f = fixture('transform');
    f.binding.settleInteraction = async () => { throw new Error('Pixel ownership mismatch'); };
    await expect(f.owner.activate('brush', f.binding)).rejects.toThrow('Pixel ownership mismatch');
    expect(f.events).toEqual([]);
    expect(f.readTool()).toBe('transform');
  });

  it.each(['scope', 'request'])('does not run stale text follow-up after %s retirement', async (kind) => {
    const f = fixture('transform');
    const gate = deferred();
    f.binding.settleInteraction = () => gate.promise;
    const after = vi.fn();
    const pending = f.owner.activate('text-point', f.binding, after);
    if (kind === 'scope') f.retire();
    else f.owner.retire();
    gate.resolve();
    await expect(pending).resolves.toBe(kind === 'scope' ? 'retired' : 'superseded');
    expect(after).not.toHaveBeenCalled();
    expect(f.events).toEqual([]);
  });

  it('rejects a stale request when another owner changed the canonical tool', async () => {
    const f = fixture('transform');
    const gate = deferred();
    f.binding.settleInteraction = () => gate.promise;
    const pending = f.owner.activate('brush', f.binding);
    f.setTool('text-point');
    gate.resolve();
    await expect(pending).resolves.toBe('superseded');
    expect(f.readTool()).toBe('text-point');
  });

  it('retains text-point/vertical edit and clears draft selection when leaving it', async () => {
    const f = fixture('select-magic-wand');
    await f.owner.activate('text-point', f.binding);
    expect(f.binding.text.finishEditing).not.toHaveBeenCalled();
    expect(f.binding.selection.reset).toHaveBeenCalledOnce();
    expect(Object.values(f.owner.preferredTools)).toContain('text-point');
  });

  it.each(['warp', 'face-warp'] as const)('retires %s through its own participant', async (tool) => {
    const f = fixture(tool);
    await f.owner.activate('brush', f.binding);
    expect(f.events).toContain(tool);
    if (tool === 'face-warp') expect(f.events).toContain('detection');
  });
});

describe('applyPersistentToolPreference', () => {
  it('preserves document interaction identity and normalizes sampled paint tips only', () => {
    const before = createEditorSession();
    before.brush.presetId = 'liquify';
    const after = applyPersistentToolPreference(before, 'clone-stamp');
    expect(after.brush.presetId).toBe('round');
    expect(after.selection).toBe(before.selection);
    expect(after.selectionMaskSnapshot).toBe(before.selectionMaskSnapshot);
    expect(after.vectorSelection).toBe(before.vectorSelection);
    expect(before.brush.presetId).toBe('liquify');
    expect(applyPersistentToolPreference(after, 'clone-stamp')).toBe(after);
  });
});
