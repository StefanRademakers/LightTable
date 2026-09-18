# LightTable agent handoff

Updated: 2026-09-13

Read this after a fresh task, handoff or context collapse. It is a compact reset
for the current architecture, not a replacement for the routed contracts under
`architecture/`. Current code and tests remain authoritative.

## First five minutes

From `D:\mediavibe\LightTable`:

```powershell
npm run context:agent
git status --short
```

The worktree is often intentionally dirty. Existing edits and untracked files
belong to the current collaboration unless proven otherwise; do not reset,
overwrite or fold them into an unrelated change.

Then read:

1. every `resume.md` reported by `context:agent`;
2. `architecture/AGENT_ONBOARDING.md`;
3. `architecture/QUICKSTART.md` and `architecture/CURRENT_STATE_AND_ROADMAP.md`;
4. the task package and only the architecture contracts routed by the change;
5. `packages/lighttable-app/AGENTS.md` before visible UI work.

## Current product and host shape

LightTable is a TypeScript, React and WebGPU-first image editor with browser and
Electron hosts. Both hosts compose the same application package. Electron and
browser APIs enter through explicit capabilities; feature and domain code must
not discover or import a concrete host directly.

Important roots:

```text
apps/web                       browser bootstrap
apps/desktop                   Electron main, preload and renderer bootstrap
packages/lighttable-app        product composition, application owners and UI adapters
packages/editor-kernel         semantic transactions, ownership and projection contracts
packages/command-contract      stable semantic command/exposure definitions
packages/*-core                serializable or backend-neutral domain contracts
packages/*-webgpu / *-wasm     concrete rendering and processing adapters
../MediaVibeUI                 independent shared suite UI workspace
```

Do not infer ownership from directory names alone. Find the current command,
controller, port and lifecycle owner before changing a workflow.

## The editor kernel is now the production mutation architecture

`@lighttable/editor-kernel` and its named application owners are the supported
semantic control plane. This is no longer a dual-route migration architecture.
Do not reconstruct a pre-kernel mutation route from Git history, old audits or
deleted callbacks.

```text
UI / shortcut / Action / MCP
              |
       one semantic command
              v
        editor kernel
   transaction + ownership
       /             \
canonical stores   projection ports
document/history   renderer/WebGPU/UI
```

Hard rules:

- UI, Actions and MCP share the same semantic command and handler.
- React is presentation and low-frequency composition, never canonical edit
  authority.
- The kernel contains no React, DOM, Electron or concrete WebGPU types.
- A gesture or edit has one owner from admission through preview and exactly one
  terminal commit/cancel/failure path.
- Preview is transient, is not history and never replaces its baseline.
- Unsupported or unavailable ownership fails visibly and closed. Never add a
  legacy fallback, optional mutation route, shadow execution or silent retry.
- Algorithms stay in their domain packages. The kernel coordinates identity,
  transactions, resource ownership, history and invalidation; it does not
  absorb paint, vector, text, filters or GPU implementations.
- `DocumentSession.documentRevision` is a monotonic invalidation stamp, not a
  command count, history identity, saved-state identity or rendered-frame stamp.

Start kernel work at `architecture/editor-kernel/README.md`, then read the
specific vertical-slice and lifetime contracts it routes.

## The former Overlay monolith has been decomposed

Task 416's O08 composition-root endpoint was accepted on 2026-09-13. Do not
describe this as replacing `LightTableEditorOverlay.tsx` with another manager.
The root still exists, but its supported role is now limited to:

- constructing named owners;
- connecting explicit ports and subscriptions;
- binding those systems to the active document/renderer;
- composing views and view-local state;
- invoking lifecycle detach/disposal.

Policy and workflow behavior were extracted into separate application and
composition systems. Named owners now cover, among other things, document-open
ordering, file intents, command admission, history navigation, tool transition
and settlement, active-layer interaction, fixed-transform completion,
processing observation/settlement, selection and layer intents, viewport input,
text/rendering lifetime, document scopes and typed-document presentation.

The boundary is more important than file count:

- a system owns one responsibility plus its state and lifetime;
- dependencies cross narrow typed contracts;
- async continuations are bound to the opening document/session/generation;
- the composition root may know which systems exist, but not implement how an
  edit works;
- do not introduce a callback/ref bag, service locator, global event bus or
  replacement `EditorManager` to reconnect the extracted systems invisibly.

The accepted O08 checkpoint reduced `LightTableEditorOverlay.tsx` from 9,090 to
4,456 physical lines and added boundary checks preventing removed authorities
from returning. That number is a regression signal, not permission for
mechanical splitting. `WebGpuEngine.ts` remains a large integration facade;
its possible O09 inventory/decomposition is separate work and must not be
smuggled into ordinary feature changes.

Current checkpoint and evidence:

- `work/todo/task_416_overlay_composition_root_cleanup/resume.md`
- `architecture/editor-kernel/OVERLAY_COMPOSITION_ROOT_CLEANUP_PLAN.md`

Treat a new defect as a defect in its named owner. Do not restore behavior or
fallback policy to Overlay merely because that looks locally convenient.

## Canonical state and projection boundaries

- `DocumentSession` owns one document's canonical tree, history, async task and
  revision/persistence lifecycle.
- Application workspace owners hold ordered typed documents and exactly one
  active document.
- Canonical document models are serializable and never own GPU handles, DOM
  nodes, Electron objects or decoded host resources.
- Renderers realize canonical state and own explicit runtime resources; they do
  not become a second writable document model.
- Content recomposition, viewport presentation, editor overlays and scope
  analysis are separate products. Pan/zoom must not recomposite content or
  rerun scopes, and overlay animation must not invalidate document pixels.
- Authored raster resources can contain the only current pixels and therefore
  are not disposable caches. Follow
  `architecture/editor-kernel/RESOURCE_LIFETIME.md` before touching their
  ownership, history retention or rollback.
- Inactive documents retain canonical/presentation state without hidden editor
  trees or recurring render loops. GPU-dependent commands fail closed when the
  required active presentation owner is not mounted.

## Shared UI is an independent package workspace

Generic suite UI no longer lives in this repository. Its canonical workspace is:

```text
D:\mediavibe\MediaVibeUI
  packages/ui             controls, tokens, icons, themes and editor chrome
  packages/ui-dockview    shared docking lifecycle, layout and drag/drop behavior
  packages/ui-temporal    shared timeline/ruler/playhead/marker presentation
  apps/ui-demo            living package catalog
  UI.bat                  catalog launcher
```

LightTable consumes public, compiled `@mediavibe/*` package contracts. The
dependency direction is one-way: MediaVibeUI must never import LightTable
documents, commands, history, renderer, WebGPU resources or host services.

For visible UI work:

1. inspect the existing control and relevant page through
   `D:\mediavibe\MediaVibeUI\UI.bat`;
2. inspect the production LightTable precedent;
3. compose package controls and keep product behavior in LightTable;
4. put a genuinely reusable missing pattern in MediaVibeUI, including its guide
   example and package tests;
5. rebuild the shared package before validating the LightTable consumer.

Feature CSS may arrange product content, canvas tools and editor-specific
geometry. It must not create a second control skin or redefine shared sizing,
typography, focus, hover, disabled, panel footer, app chrome, tab or docking
language. Do not copy MediaVibeUI sources into LightTable or import its private
`src` modules.

`@mediavibe/ui-dockview` owns generic panel setup, persistence hooks and shared
drag/drop behavior. LightTable remains owner of its panel registry, contents,
workspace presets and product-specific docking policy. Similarly,
`@mediavibe/ui-temporal` owns generic temporal presentation, not media projects,
transport, edits or commands.

The package is currently consumed through the sibling workspace. A pinned
release/remote CI channel is still an operational follow-up for multi-machine
distribution; do not create a parallel local UI authority while that remains
open.

## Commands, Actions and MCP

Stable semantic command IDs are the integration boundary. Menus, shortcuts,
tools, Actions and MCP adapters call the same application service; none may
implement a private mutation or infer success from presentation state.

Command definitions, availability, validation, permission and serialization
belong at their existing contract/application boundary. External inputs are
untrusted, capability-gated and bounded. MCP and automation adapters never
receive renderer internals, GPU resources, filesystem authority or application
stores as an escape hatch.

Read `architecture/editor-kernel/COMMAND_ROUTING.md` and the relevant material
under `architecture/integrations/` before changing exposure or automation.

## Working and verification discipline

- Prefer the smallest complete vertical slice: request -> admission -> preview
  if applicable -> terminal state -> history/resources -> presentation.
- Preserve pointer-rate and slider-rate hot paths outside React and general
  command queues. Do not add readbacks, full-document traversals or GPU waits per
  input sample.
- Run the nearest focused tests while iterating, then widen according to the
  changed boundary.
- `npm run verify:boundary` checks dependency and ownership rules.
- `npm run audit:source-structure` checks structural regressions.
- `npm run typecheck` checks every typed workspace package.
- `npm run build:web` validates the browser host.
- `npm run package:desktop:verify` creates the instrumented Electron package.
- `npm run verify` is the broad repository gate; `build.bat` additionally makes
  the Windows installer. Do not run the broadest gate after every small edit.
- A unit test does not prove renderer, resource, timing or packaged-host
  behavior. Use the routed real-app smoke/acceptance gate for the affected
  boundary.

## Known open boundaries

- Owner visual/feel acceptance can still expose product defects; accepted
  architecture does not mean the whole app is bug-free.
- `WebGpuEngine.ts` remains a separately scoped architectural hotspot.
- The MediaVibeUI sibling workspace still needs an independent remote/CI and a
  pinned release channel before portable multi-machine distribution.
- Older audits and completed migration ledgers are evidence, not extension
  guidance. Never revive a retired route because an old report mentions it.

When code, this handoff and a canonical architecture contract disagree, stop
and reconcile the current code/tests with the contract instead of choosing the
most convenient description.
