import { describe, expect, it } from 'vitest';
import type { LightTableRecoveryListing, LightTableRecoveryRecord } from '../platform/LightTableRecoveryStore';
import { newestRecoveryRecords, planRecoveryWorkspace } from './LightTableStandaloneApp';

const record = (
  recoveryId: string,
  documentIdHash: string,
  revision: number,
  updatedAt: number
): LightTableRecoveryRecord => ({
  version: 1,
  recoveryId,
  documentIdHash: documentIdHash.repeat(64).slice(0, 64),
  sourceFingerprintSha256: 'a'.repeat(64),
  canonicalRevision: revision,
  historyStateId: revision,
  savedStateId: 0,
  createdAt: updatedAt,
  updatedAt,
  artifactByteLength: 10,
  artifactChecksumSha256: 'b'.repeat(64),
  mediaType: 'image/png'
});

describe('newestRecoveryRecords', () => {
  it('presents only the newest valid generation per document', () => {
    const listing: LightTableRecoveryListing = {
      records: [
        record('recovery-a-old', '1', 2, 2_000),
        record('recovery-b-new', '2', 4, 4_000),
        record('recovery-a-new', '1', 3, 3_000)
      ],
      rejections: [{ recoveryId: 'broken', reason: 'malformed', message: 'bad' }]
    };
    expect(newestRecoveryRecords(listing).map(({ recoveryId }) => recoveryId))
      .toEqual(['recovery-b-new', 'recovery-a-new']);
  });

  it('restores workspace order, requested active tab and skips crash-loop records', () => {
    const first = { ...record('recovery-first', '1', 1, 1_000), workspaceOrder: 0 };
    const broken = { ...record('recovery-broken', '2', 1, 2_000), workspaceOrder: 1 };
    const active = {
      ...record('recovery-active', '3', 1, 3_000),
      workspaceOrder: 2,
      wasActive: true
    };
    const plan = planRecoveryWorkspace(
      { records: [active, broken, first], rejections: [] },
      (id) => id === 'recovery-broken'
    );
    expect(plan.records.map(({ recoveryId }) => recoveryId))
      .toEqual(['recovery-first', 'recovery-active']);
    expect(plan.activeRecoveryId).toBe('recovery-active');
  });
});
