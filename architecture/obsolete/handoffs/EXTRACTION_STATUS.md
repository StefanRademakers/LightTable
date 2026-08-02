# Extraction status

## Boundary

- [x] LightTable source copied into an independent workspace.
- [x] Existing `docs/lighttable` retained in full.
- [x] Referenced icons copied into LightTable-owned assets.
- [x] Replace StoryBuilder common UI imports with LightTable primitives.
- [x] Replace direct StoryBuilder media API calls with host capabilities.
- [x] Standalone web build and automated verification.
- [x] Thin Electron host and packaged Windows x64 build.
- [x] StoryBuilder adapter consuming a versioned package artifact.
- [x] Parallel StoryBuilder legacy and extracted production builds.
- [x] Live StoryBuilder development mode against package source.
- [ ] StoryBuilder functional workflow comparison signed off.
- [ ] Remove the old StoryBuilder implementation after sign-off.

## Host contract

LightTable may request capabilities such as browsing or reading host media.
It must not know whether a host uses S3, a REST API, IndexedDB or the local
filesystem. StoryBuilder's future media browser therefore implements
`LightTableMediaBrowser`; Electron can implement the same contract with native
dialogs and files.

The Electron renderer has no Node integration. A sandboxed preload exposes only
native open and save operations, and the main process validates the IPC sender
and arguments. All editor rendering, UI and document logic remains shared.

## Documentation map

The original notes remain available, but they are now classified in
`docs/lighttable/README.md`. That index distinguishes active plans,
authoritative contracts, feature trackers, deferred research, superseded
proposals and historical implementation notes. Preserve useful research while
keeping current authority unambiguous.

## Verified extraction baseline

- 44 of 44 documentation files match the source tree byte-for-byte.
- 43 test files pass (286 tests).
- TypeScript passes for the app, web host and desktop host.
- The standalone Vite web production build passes.
- Electron Forge produces `apps/desktop/out/LightTable-win32-x64/LightTable.exe`.
- No editor source imports StoryBuilder components, routes, environment
  variables, S3 details or `/public/icons`.
- StoryBuilder's normal `npm run build` still selects its local rollback
  runtime. `npm run build:lighttable` selects the extracted package.
- StoryBuilder's `npm run dev:lighttable` points directly at this repository's
  package source and supports Vite HMR.

`npm run verify:boundary` makes the last boundary check repeatable. The complete
`npm run verify` command also runs typechecking, tests, the web build and the
desktop package build.

## Dependency audit note

The production dependency audit currently reports two high findings inherited
from the optional `sharp` dependency of `@huggingface/transformers`. The desktop
toolchain also contains development-only advisories through Electron Forge's
packaging dependencies. These are recorded rather than hidden; update them when
compatible upstream releases are available and repeat the package smoke test.

## Reference-source note

`Darkly` and `DarkTable` are research references only. Neither repository is a
runtime dependency, copied implementation source, build input or host adapter.
Future brush research may compare concepts, but extracted LightTable code and
assets remain independently owned.
