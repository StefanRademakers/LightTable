'use strict';

/**
 * Resolve the only two supported macOS signing modes.
 *
 * Private local builds still need an ad-hoc signature on Apple Silicon, but
 * must not enable Hardened Runtime: an identity-less hardened main executable
 * cannot establish the same-team library-validation relationship with
 * Electron Framework. Developer ID builds deliberately enable Hardened
 * Runtime because notarization requires it.
 */
const resolveMacSigningPolicy = (platform, environment) => {
  if (platform !== 'darwin') return undefined;
  const identity = environment.LIGHTTABLE_MAC_SIGN_IDENTITY?.trim();
  return identity
    ? {
        identity,
        // @electron/osx-sign 1.3 applies signing flags through its per-file
        // merge. A top-level hardenedRuntime property is ignored.
        optionsForFile: () => ({ hardenedRuntime: true })
      }
    : {
        identity: '-',
        identityValidation: false,
        optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' })
      };
};

module.exports = { resolveMacSigningPolicy };
