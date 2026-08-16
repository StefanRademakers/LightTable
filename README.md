# LightTable

LightTable is a WebGPU-first image editor with shared web and desktop hosts.

This repository is being extracted from StoryBuilderOnline using a strangler
migration. The editor engine, UI, CSS, icons, tests and design notes live here;
product hosts connect through explicit capabilities instead of importing host
state, S3 details or application routes.

## Current editing model

- `Properties` is one contextual dock tab. A Layers-tree selection routes it
  to an independently owned Grade, Lens Fx, adjustment, Text or Layer Effects
  editor; it is not one monolithic inspector component.
- Non-destructive processing can live as a standalone adjustment layer, with a
  linked white mask by default, or as an ordered adjustment attached to one
  raster layer. Both forms are visible and directly selectable in Layers.
- The compositor builds a pure ordered plan before WebGPU encoding. Layer and
  attached-adjustment order are semantic; optimization may only fuse proven
  equivalent nodes. Working composition uses linear-light `rgba16float`, while
  the current released PSD writer remains an explicit 8-bit RGB subset.
- Photoshop-family adjustment descriptors now round-trip for the supported
  set. Color Lookup can load a 3D `.cube` file, retain its exact bytes as a
  LightTable document asset and embed it in supported PSD interchange.
- Shared UI lives under `packages/lighttable-app/src/ui`. Production screens
  and, in an explicit UI-devtools build, **View > UI Style Guide...** render the same components; contextual
  geometry is an explicit variant rather than CSS inherited from a container.

## Development

```bash
npm install
npm run dev:web
npm run dev:desktop
npm test
npm run audit:ui-boundary
npm run build:web
npm run package:desktop
```

Vite hot-updates the standalone web editor. Electron Forge hot-updates renderer
code and CSS; changes to Electron main/preload or packaging require restarting
the desktop process. Both dev hosts resolve `@lighttable/app` directly to the
workspace source, so edits to `theme.css`, `primitives.css`, `lighttable.css`
and host CSS are applied without rebuilding or recreating the open document.
After changing a Vite config itself, restart that dev host once.

During the extraction, run `npm run dev:lighttable` from
`D:\mediavibe\StoryBuilderOnline\client` to use this checkout directly inside
StoryBuilder with HMR. StoryBuilder's normal `npm run dev` remains the legacy
rollback route until the functional comparison is signed off.

The canonical product and engineering contracts live in [`architecture/`](architecture/README.md).
After a fresh AI session or context collapse, start with
[`architecture/AGENT_ONBOARDING.md`](architecture/AGENT_ONBOARDING.md), run
`npm run context:agent`, and use
[`architecture/QUICKSTART.md`](architecture/QUICKSTART.md) for the technical
system model; then load only the contracts routed by the change.
Material under `docs/` is historical research and handoff context; it is not
the source of architectural truth.

The web and desktop applications use the same `@lighttable/app` package.
Electron is a native file-dialog and filesystem host only; it does not contain
a second editor implementation.

## Versioned work queue

Concrete task packages live in [`work/todo`](work/todo) and completed evidence
in [`work/done`](work/done). The queue is tracked in Git for multi-machine work
but excluded from every build and deployment artifact.

The instruction **"werk alle openstaande tasks uit"** means: process the whole
queue in order, implement and test each task, make a focused local commit for
each verified milestone, move its package to `work/done`, and continue without
requesting confirmation. A status request does not cancel that instruction.
The full workflow and blocker rules are in [`work/README.md`](work/README.md).
