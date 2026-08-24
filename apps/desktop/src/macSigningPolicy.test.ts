import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { resolveMacSigningPolicy } = require('../macSigningPolicy.cjs') as {
  resolveMacSigningPolicy: (
    platform: string,
    environment: Record<string, string | undefined>
  ) => Record<string, unknown> | undefined;
};

describe('macOS signing policy', () => {
  it('keeps private ad-hoc packages runnable without same-team library validation', () => {
    const policy = resolveMacSigningPolicy('darwin', {})!;
    expect(policy).toMatchObject({ identity: '-', identityValidation: false });
    expect(policy.optionsForFile).toBeTypeOf('function');
    expect((policy.optionsForFile as () => unknown)()).toEqual({
      hardenedRuntime: false, timestamp: 'none'
    });
  });

  it('requires Hardened Runtime for Developer ID packages', () => {
    const policy = resolveMacSigningPolicy('darwin', {
      LIGHTTABLE_MAC_SIGN_IDENTITY: ' Developer ID Application: MediaVibe (TEAM123) '
    })!;
    expect(policy).toMatchObject({
      identity: 'Developer ID Application: MediaVibe (TEAM123)'
    });
    expect(policy.optionsForFile).toBeTypeOf('function');
    expect((policy.optionsForFile as () => unknown)()).toEqual({ hardenedRuntime: true });
  });

  it('does not sign non-macOS packages through the macOS policy', () => {
    expect(resolveMacSigningPolicy('win32', {})).toBeUndefined();
  });
});
