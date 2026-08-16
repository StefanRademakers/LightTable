# Desktop release and update boundary

Status: implemented alpha release boundary, 6 August 2026.

## Version and channels

`apps/desktop/package.json` is the executable's semantic-version source. The
current product version is `0.1.0-alpha.1`. Forge, Electron `app.getVersion()`
and About therefore report the same value. CI may attach an opaque build ID via
`LIGHTTABLE_BUILD_ID`; it may not replace semantic versioning.

- `dev`: unpackaged local runs and internal builds; accepts every signed feed.
- `preview`: prerelease packages; accepts preview and stable releases.
- `stable`: release packages without a SemVer prerelease; accepts stable only.

`LIGHTTABLE_RELEASE_CHANNEL` may select a CI channel explicitly. An invalid
value is ignored. Alpha builds make no promise that a future unsupported native
schema can be opened by an older binary.

## Package and permission inventory

Forge produces an ASAR-packed desktop application plus platform makers. The
Windows unpacked release contains `LightTable.exe`, Electron/Chromium, the ASAR,
locale/runtime resources, Electron's license and Chromium notices. The existing
distribution check proves that `work/` and development corpora are absent and
that text WASM assets are present. The release verifier additionally hashes
every packaged file, rejects credential-shaped files, and emits a deterministic
file manifest under `tmp/release`.

The renderer keeps `contextIsolation`, sandboxing and no Node integration. It
denies new windows and untrusted navigation; IPC validates its sender. The CSP
permits only self/data/blob assets, local workers and WebAssembly evaluation.
The packaged renderer's loopback origin is protected by COOP/COEP/CORP and a
minimal permissions policy. File dialogs, atomic save, private recovery,
clipboard, system-font reads and update checks are explicit preload capabilities.

## Signing and notarization

Local packages are intentionally unsigned and About says so. No certificate,
private key, Apple credential, token or update-provider credential belongs in
Git. Forge activates macOS signing only with `LIGHTTABLE_MAC_SIGN_IDENTITY` and
notarization only when the CI secret set is complete. The cross-platform build
workflow and Windows Squirrel installer now exist; Windows Authenticode and the
production installer handoff remain unavailable until a certificate-backed CI
provider is selected. CI must verify the resulting OS signature before it sets
`LIGHTTABLE_RELEASE_SIGNED=true`; this flag is product metadata, not itself a
cryptographic proof. See [Build and distribution](BUILD_AND_DISTRIBUTION.md).

Production signing is therefore an explicit external gate, not a silent local
fallback. The repository can fully test signature verification without owning
production secrets by generating ephemeral Ed25519 keys in tests.

## Signed update protocol

Update manifests use schema 1 and contain product, SemVer, channel, publish
time, release notes, native/recovery compatibility declarations and exactly one
HTTPS artifact with byte length and SHA-256. An Ed25519 signature covers the
canonical manifest excluding `signature`. The desktop verifies the signature
and channel/version policy before downloading, then verifies exact length and
hash before atomic private publication. Invalid, tampered, older, unavailable
and timed-out/canceled results do not modify the installation.

`LIGHTTABLE_UPDATE_MANIFEST_URL` and `LIGHTTABLE_UPDATE_PUBLIC_KEY_PEM` configure
a feed. `scripts/sign-update-manifest.mjs` reads a private key only from the path
named by `LIGHTTABLE_UPDATE_PRIVATE_KEY_FILE`. A verified download is not
executed until a production installer adapter exists. About exposes that state
honestly; its Restart action is disabled without an adapter and is always
blocked while any document is dirty. Updates never force a restart.

## Compatibility and rollback

- The native LightTable format has one disposable internal-alpha schema.
  Saves and reads use version 1 only; every other version fails explicitly.
  Compatibility and migrations begin with the first public release.
- Recovery version 1 is accepted; unknown versions are isolated with a reason.
- The updater never offers an equal/older version. Manual binary rollback is
  supported only when every document/recovery schema is within that binary's
  declared read range.
- Preview/stable channel rules prevent cross-channel downgrade. A failed check,
  download, signature, hash, publish or user cancel leaves the running install
  and its documents untouched.
- Before the native format is frozen, migrations may deliberately end alpha
  compatibility; release notes and the compatibility declaration must say so.

## Reproducible verification

1. `npm run generate:third-party && npm run generate:release-artifacts`
2. `npm run package:desktop:verify`
3. `npm run verify:desktop-release`
4. `npm run smoke:desktop:release`

The clean-user-data smoke launches the packaged executable, opens TextTest,
checks renderer isolation/CSP, opens Help > About LightTable, verifies truthful
version/channel/signature/update-unavailable UI and performs a normal atomic
Save. Update unit fixtures cover valid, tampered, older and channel-blocked
manifests plus artifact hashes. External Authenticode/notarization remains a
production credential gate and must not be reported as passing locally.
