# Project-mode feature gating

**Status:** current implementation audit  
**Audited:** 2026-08-14  
**Authority:** current application and desktop-host code

This document indexes which LightTable features currently require an active
project. It distinguishes a real functional gate from project-backed
persistence and from features that remain fully available in a standalone
workspace.

## Summary

Project mode currently owns two concerns:

1. the project asset catalog and its on-disk folder/index/thumbnail lifecycle;
2. the durable GenAI job, input, output and request-history lifecycle.

The second concern currently makes **all GenAI generation** project-only. This
is stronger than the panel text suggests: without a project the user can edit
the GenAI form and add session references, but cannot press Generate.

## Hard project gates

These features do not execute without an active project.

| Feature | Current gate | Why it is gated today |
| --- | --- | --- |
| GenAI Image Create | `canGenerate` requires `projectId`; submission uses `submitGeneration(projectId, ...)` | Jobs and generated files are written into the project lifecycle. |
| GenAI Image Edit | Same gate as Image Create | The request and delivered result use the project job and asset stores. |
| Remove Object | The editor and command both reject a missing project | The full-document base image and selection mask are imported as project assets before an `image.inpaint` job is submitted. |
| GenAI jobs and running-state tracking | Job controller clears its state without `projectId` | Job listing, subscriptions and delivery deduplication are selected by project. |
| AI History | No project produces no jobs or project asset catalog | Finished and running items are backed by the project job/history stores. |
| Project Asset Browser | Asset catalog is cleared without `projectId` | It scans the active project's configured and discovered directories. |
| Asset search and section browsing | Requires the project catalog | Search is a presentation over indexed project assets. |
| Asset rescan | `refreshProjectAssets(projectId)` | Rebuilds the active project's disk index and thumbnails. |
| Project asset preview/open | Preview and file loading calls require `projectId` | Asset identifiers are scoped to a project index. |
| Project asset reveal, rename and delete | Host handlers require the active project | These mutate or reveal files inside the active project. Delete moves files through the project Trash policy. |
| Open/place a generated result | Runtime refuses the operation without `activeProject` | It resolves the result through `loadProjectAsset(activeProject.id, assetId)`. |
| Recreate/use persisted GenAI settings | Depends on a project job/request record | The original prompt, references and output settings live with the project job. |

Project lifecycle commands such as Close Project and reveal project folder are
also naturally disabled when no project is active; these are lifecycle
controls rather than editor-feature gates.

## Project-backed enhancements, not hard gates

These features still have useful standalone behavior, while an active project
adds persistence or indexing.

| Feature | Standalone behavior | Added by project mode |
| --- | --- | --- |
| Save LightTable/document file | Saves normally and updates recent files | Also schedules project asset indexing and thumbnail generation. |
| GenAI form editing | Provider/model/mode can load; prompt and form values can be edited | Selected setup is loaded from and saved to the active project. |
| Local visual-reference import | Creates a session-only asset with an in-memory data-URL preview | Copies/imports the file into project-managed input storage and indexes it. |
| Add base image / pasted reference / dropped document tab | Can exist as a session reference | Becomes durable and discoverable through the project input/catalog lifecycle. |
| Provider connection and model discovery | Works without a project | No additional capability; project mode only supplies durable request/output context. |
| Local AI provider lifecycle | Works independently of projects and independently of Agent Access/MCP | A project is only required when a project-backed GenAI command submits a durable job. |

The current session-reference path does not make standalone generation usable,
because Generate itself remains hard-gated by `projectId`.

## Explicitly not project-gated

The following systems remain available in a standalone workspace:

- New, Open, Open Place and normal document tabs;
- Save, PNG/JPEG/PSD/PDF export and format-support inspection;
- layers, groups, masks, blend modes and layer effects;
- paint, healing, clone, dodge/burn/sponge and other local paint operations;
- selections, Object Selection, Select Subject and local mask editing;
- **Remove Background**, which runs the local BEN2 model and applies an
  editable mask directly to the active raster layer;
- transforms, vector shapes, paths, gradients and text authoring;
- Grade, Lens Fx and document color operations;
- image size, canvas/document operations and history/undo;
- autosave, crash recovery, recent files and document thumbnails;
- workspace presets such as Photo Edit and AI Generation;
- provider authentication, provider/model discovery and local provider health;
- Agent Access and the LightTable MCP command surface.

`Remove Background` and `Remove Object` must remain separate architectural
concepts. Remove Background is local document processing; Remove Object is
currently a provider-backed GenAI generation job.

## Gates that need an explicit product decision

### GenAI generation without a project

The UI currently says “Open a project to retain output history,” which implies
that only retention is unavailable. The implementation instead disables
Generate completely. Either:

- keep generation deliberately project-only and change the UI to say so; or
- introduce a standalone generation workspace/output sink, so generation can
  run without a project and only durable project history remains gated.

Do not solve this by making provider adapters aware of project folders.
Provider adapters should translate the provider-neutral request. A host-owned
generation workspace should own input publication, job persistence and result
storage.

### Remove Object without a project

Remove Object is coupled to projects because its base image, mask and result
use the project asset/job store. The command itself does not semantically need
a project. If standalone use is desired, give it the same standalone
generation workspace/output sink rather than adding a special-case path.

### Generated-result delivery

Opening a generated image or placing an edit result currently resolves the
file through the active project. A future standalone generation store must
offer the same asset-loading contract so the editor delivery path does not
branch by provider or command.

## Canonical dependency direction

```text
editor command / GenAI UI
        -> provider-neutral GenAI application service
        -> generation workspace (project-backed today)
        -> provider adapter

project asset browser
        -> project asset catalog
        -> desktop filesystem/index/thumbnail service
```

Project mode may select a durable generation workspace. It must not leak into
provider authentication, local model lifecycle, MCP/Agent Access, rendering,
painting or ordinary document commands.

## Code ownership map

- Project-aware GenAI setup and Generate gate:
  `packages/lighttable-app/src/genai/application/useGenAiSetupController.ts`
- Project job subscriptions and history:
  `packages/lighttable-app/src/genai/application/useGenAiJobsController.ts`
- Remove Object gate:
  `packages/lighttable-app/src/genai/application/removeObjectCommand.ts`
- Runtime result opening/placement and project-enhanced Save:
  `packages/lighttable-app/src/standalone/StandaloneDocumentRuntimeView.tsx`
- Desktop project, job and asset IPC enforcement:
  `apps/desktop/src/main.ts`
- Project disk/index/thumbnail implementation:
  `apps/desktop/src/projectAssetService.ts`
- Local standalone Remove Background:
  `packages/lighttable-app/src/lighttable/application/backgroundRemoval/useBackgroundRemovalController.ts`

