# LightTable

LightTable is a WebGPU-first image editor with shared web and desktop hosts.

This repository is being extracted from StoryBuilderOnline using a strangler
migration. The editor engine, UI, CSS, icons, tests and design notes live here;
product hosts connect through explicit capabilities instead of importing host
state, S3 details or application routes.

## Development

```bash
npm install
npm run dev:web
npm run dev:desktop
npm test
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
Start there when changing a system boundary or transferring the project to a
new engineer or AI agent. Material under `docs/` is historical research and
handoff context; it is not the source of architectural truth.

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
