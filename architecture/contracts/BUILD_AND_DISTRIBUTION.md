# Build and distribution

Status: automated internal distribution boundary, 23 August 2026.

## Renderer build invariant

All normal web and desktop outputs now contain LightTable's single hybrid
vector renderer. `npm run dev:web`, `npm run dev:desktop`,
`npm run build:web`, `npm run package:desktop`, `run_clean.bat`,
`run_dev.bat`, `run_release.bat` and `build.bat` do not select competing
renderer products. The retired `dev:*:vello`, `package:desktop:vello` and
`LIGHTTABLE_VECTOR_BACKEND` product switches must not be used in onboarding or
restored as release variants.

The root `ensure:wasm` gate verifies generated text shaping, SVG normalizer and
Vello WASM bindings before development/typecheck/build. The Vello source is
pinned and its reviewed compatibility patch is verified by the generator; a
local `.referenceCode` checkout is research only and is not shipped.

`npm run package:desktop` creates the unpacked application under the configured
Forge output directory (normally `apps/desktop/out/LightTable-win32-x64` on
Windows). It does not create an installer. `npm run make:desktop` creates maker
artifacts. On Windows, `build.bat` runs the full `npm run verify` boundary and
then makes the Squirrel installer in `apps/desktop/out-verify/make/...`.

## Supported outputs

LightTable has one source tree and three independently built distributions:

| Target | Build host | Command | Output |
| --- | --- | --- | --- |
| Windows desktop | Windows | `npm run make:desktop` | Squirrel `Setup.exe`, update `.nupkg` and `RELEASES` manifest |
| macOS desktop | macOS | `npm run make:desktop` | signed application in a ZIP archive |
| Web | Linux, macOS or Windows | `npm run build:web` | static application under `apps/web/dist/` |

Electron desktop distributions are built on their target operating system.
Running the workflow from a Windows browser or workstation does not make the
Windows machine cross-compile macOS: GitHub Actions assigns the macOS job to a
real hosted Mac runner. This preserves the native packaging, signing and Apple
notarization toolchain.

## Automated workflow

`.github/workflows/build-distributions.yml` runs manually from GitHub Actions
or automatically for a `v*` tag. It performs the shared boundary, type, test
and UI audits once, then builds Windows, macOS and web in parallel. Successful
runs expose three downloadable workflow artifacts:

- `lighttable-windows-x64`, containing the installer and Squirrel update files;
- `lighttable-macos-<architecture>`, containing the macOS ZIP;
- `lighttable-web`, containing the production static web build.

Artifacts are retained for 14 days. A public release or web deployment remains
a deliberate promotion step; a successful build does not silently publish it.

## Windows installer

The Windows maker is Squirrel.Windows. A local build currently produces:

```text
apps/desktop/out/make/squirrel.windows/x64/
  LightTable-<version> Setup.exe
  LightTable-<version>-full.nupkg
  RELEASES
```

This is a real per-user installer, but local and CI artifacts remain unsigned
until a production Windows Authenticode certificate and signing provider are
configured. Do not describe an unsigned package as a production installer.

## macOS signing and notarization

Manual workflow runs without Apple secrets produce an ad-hoc signed build for
private testing. A tagged build fails closed unless all of these GitHub Actions
repository secrets are present:

- `MAC_CERTIFICATE_P12_BASE64`: Base64-encoded Developer ID Application `.p12`;
- `MAC_CERTIFICATE_PASSWORD`: password for that `.p12`;
- `MAC_SIGN_IDENTITY`: the exact Developer ID Application identity;
- `APPLE_ID`: Apple Developer account email;
- `APPLE_APP_PASSWORD`: app-specific password;
- `APPLE_TEAM_ID`: Apple Developer Team ID.

The workflow imports the certificate into a temporary keychain, asks Forge to
sign the application, enables `notarytool` notarization for tags, verifies the
result with `codesign`, and removes the temporary keychain even after failure.
No signing credential belongs in the repository.

The current macOS deliverable is a ZIP, not a DMG. Add a DMG maker only when its
install-window presentation and signing are treated as a designed product UI,
rather than adding a second unreviewed packaging surface.

## Web deployment boundary

The web artifact is host-neutral, but the host is not. LightTable's WebGPU and
WASM runtime expects these production response headers, already used by the
Vite development and preview servers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: cross-origin-isolated=(self)
```

Choose a static host or edge deployment that can attach those headers. The
generic build workflow deliberately does not assume GitHub Pages because its
deployment does not provide this per-project header contract. Once a provider
is selected, add a promotion job that deploys the already verified
`lighttable-web` artifact instead of rebuilding different source.

## Release promotion still required

Before a public desktop release, retain the stronger gates from
`DESKTOP_RELEASE_AND_UPDATE.md`: generate legal/release artifacts, verify the
packaged boundary, run the clean-user-data release smoke and complete the
supported-hardware soak. Windows Authenticode, an exercised updater/rollback
adapter and public artifact publication are not introduced by this workflow.
