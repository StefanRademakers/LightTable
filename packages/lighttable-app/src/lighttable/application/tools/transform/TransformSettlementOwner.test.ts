import { describe, expect, it, vi } from 'vitest';
import {
  requireTransformSettlementRecovery,
  TransformSettlementOwner
} from './TransformSettlementOwner';

describe('TransformSettlementOwner', () => {
  it('rejects the captured admission once and returns to idle for recovery', async () => {
    let reject!: (reason: unknown) => void;
    const operation = new Promise<void>((_resolve, rejectOperation) => { reject = rejectOperation; });
    const reportFailure = vi.fn();
    const owner = new TransformSettlementOwner();
    expect(owner.isPending()).toBe(false);
    const captured = owner.publish(operation, reportFailure);
    expect(owner.isPending()).toBe(true);

    reject(new Error('GPU publication failed'));
    await expect(captured).rejects.toThrow('GPU publication failed');
    await expect(owner.read()).resolves.toBeUndefined();
    expect(owner.isPending()).toBe(false);
    expect(reportFailure).toHaveBeenCalledOnce();
  });

  it('does not let an older settlement retire a newer operation', async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const second = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const owner = new TransformSettlementOwner();
    owner.publish(first, vi.fn());
    owner.publish(second, vi.fn());

    releaseFirst();
    await first;
    expect(owner.read()).toBe(second);
    expect(owner.isPending()).toBe(true);
    releaseSecond();
    await second;
    await expect(owner.read()).resolves.toBeUndefined();
    expect(owner.isPending()).toBe(false);
  });

  it('rejects the failed handoff, then requires exact recovery before later admission', async () => {
    let reject!: (reason: unknown) => void;
    const failed = new Promise<void>((_resolve, rejectOperation) => { reject = rejectOperation; });
    const owner = new TransformSettlementOwner();
    const recover = vi.fn(async () => false);
    const captured = owner.publish(failed, vi.fn());
    const currentAdmission = requireTransformSettlementRecovery(captured, recover);
    reject(new Error('publication failed'));

    await expect(currentAdmission).rejects.toThrow('publication failed');
    expect(recover).not.toHaveBeenCalled();
    await expect(requireTransformSettlementRecovery(owner.read(), recover))
      .rejects.toThrow('document mutation remains blocked');
    recover.mockResolvedValue(true);
    await expect(requireTransformSettlementRecovery(owner.read(), recover)).resolves.toBeUndefined();
  });
});
