# GenAI bounded context

Status: **implemented provider boundary with project-backed image and video generation**,
updated 2026-09-09.

## Decision

LightTable implements generation as an optional bounded context. The editor,
document model and render loop do not depend on a provider SDK. The first
provider is OpenArt, but provider terminology does not leak into the reusable
panel or job model.

## Package ownership

```text
@lighttable/genai-core
  provider-neutral domain contracts
  schema normalization
  generation/job state transitions
          ^
          |
@lighttable/genai-openart
  OpenArt MCP catalog and generation adapter
  provider response normalization
          ^
          |
@lighttable/genai-higgsfield
  Higgsfield MCP contract negotiation and schema projection
  image/video request and response normalization
          ^
          |
@lighttable/genai-local
  local provider protocol and model/job contracts
          ^
          |
@lighttable/desktop
  OAuth/PKCE and loopback callback
  Electron safeStorage
  provider transport, local process and filesystem output
  narrow IPC handlers
          ^
          |
@lighttable/app
  host bridge and projected snapshots
  native Dockview panel composed from existing UI primitives
```

Arrows point from a consumer to the dependency it may use. Imports in the
opposite direction are forbidden.

## Dependency rules

- `genai-core` is TypeScript-only and may not import React, Electron, browser
  globals, Node filesystem/network modules, editor code or provider packages.
- `genai-openart` and `genai-higgsfield` may import `genai-core` and the MCP client. They may not import
  React, Electron, editor, document or rendering code.
- `desktop` owns credentials, provider transports, OAuth, absolute paths and
  file writes. Tokens and absolute paths never cross IPC into React state.
- `lighttable-app` may import only the public contracts from `genai-core`.
  Provider packages are loaded by the desktop host only when connection,
  catalog discovery or generation is requested.
- GenAI never participates in the render frame loop and never dirties the
  document renderer merely because panel or job state changes.
- Generated media enters LightTable through existing project asset and
  document commands, not through direct mutations from provider code.

## Runtime boundary

The renderer sees immutable, serializable snapshots and invokes explicit
commands such as `connectProvider`, `loadCatalog`, `submitGeneration`,
`cancelJob` and `openResult`. It never receives an MCP transport, token,
provider client or unrestricted filesystem capability.

## Output and panel invariants

- The setup panel owns model, prompt and provider-defined fields only.
- Queue and history are shown in a separate Dockview panel backed by the same
  provider-neutral job store; closing either panel never stops a job.
- Every successful output is atomically stored in the active project's logical
  `aiHistory` location (default `AI/History`) before editor mutation.
- Video output is retained in AI History as MP4 or WebM and is not opened as an
  image document. Reveal remains available while a video workspace is deferred.
- Every submitted job persists host-private editor-delivery provenance: project,
  source document, source revision and `place-edit`/`open-new` behavior. Provider
  adapters must not serialize this metadata.
- Image-edit results are placed as the top layer only when the completion still
  addresses that exact project and document. Image-create results open only
  while their original project remains active. Automatic delivery without
  provenance, or after a project/document switch, fails closed before asset
  loading; the durable result remains available through explicit History Open.
- Placement uses the normal transient-artifact `layer.placeArtifact` command
  and its history owner. Open waits for the new document's terminal decode
  state; neither route may report success for a rejected or failed terminal.
- Remote completion, durable local storage and editor placement are distinct
  stages. A placement/open failure must not discard or resubmit a paid render.

## Reference publication

### Editor-to-reference handoff

GenAI owns workflow fields, reference assets, providers and jobs independently
of editor state. `GenAiReferenceHandoff` is the narrow application adapter for
document-to-reference requests; its mounted binding supplies document export
and exact session/renderer readiness. It does not own provider discovery,
generation, GPU resources or document mutation. The Overlay only wires it.

Setup captures a reference-import lease before document export or file reads.
That lease binds the service, project, provider, model and workflow lifetime;
both asynchronous completions and deferred UI updaters recheck it. A retired
attachment cannot publish into a successor context. Any already imported
durable asset stays in its original project library.

The base image is one current document/project snapshot, not a live per-frame
mirror or a multi-document cache. Workflow changes can reattach that snapshot;
unchecking clears its association, and checking again captures a fresh image.
Tab-reference requests capture Setup authority before activation and capture
the source only after the requested document's export binding is ready.
Promise completion is not acknowledgement that deferred UI state has applied.

Generate reads delivery provenance from the ready canonical document session
at submission, separately from low-frequency panel presentation. This does
not by itself establish paid-job lifetime safety for other entry points.

Remove Object has a separate mounted intent and source-capture adapter. It pins
the exact project/service/session/renderer and canonical revision/coverage after
existing file preparation. Existing document mutation admission spans final
projection/readiness until GPU copy submission only; mapping, mask conversion
and encoding do not keep editing locked. Changes during preparation retire the
request before submission, rather than silently recapturing a different source.
The GenAI command still owns discovery, imports and submission, checks authority
at asynchronous boundaries, and sends explicit place-edit provenance. Already
imported original-project assets survive retirement. Once submission begins,
retirement does not cancel or retry a potentially paid operation. Packaged local
fixtures verify this input/submission boundary, not provider result placement.

Prompt mentions and provider references are two linked but different values.
The renderer retains a friendly token such as `@hero`; the provider adapter
translates it to a stable positional token such as `@image1`. The generation
payload must also contain the matching media object, for example:

```json
{
  "visualReferences": [{
    "type": "image",
    "id": "image1",
    "label": "image1",
    "url": "https://short-lived.example/reference.png"
  }]
}
```

OpenArt's MCP generation contract accepts reachable media URLs. LightTable
discovers and uses OpenArt's native signed-upload tools; interactive host upload
widgets, local paths and renderer-owned network publication are not used.

LightTable follows the same boundary through a desktop-owned reference
publisher. React supplies only opaque project asset IDs. The desktop resolves
and validates the bytes, hashes their content revision, then either reuses a
provider-scoped publication or publishes again. OpenArt uses its discovered
signed-upload contract and retains the resulting HTTPS URL. Higgsfield's native
contract uses `media_upload`, a signed PUT and `media_confirm`, then submits the
confirmed provider media ID. Local paths, `file:` URLs, localhost URLs and data
URLs are never submitted. Until every reference has a valid transport identity,
generation fails before the paid provider call instead of silently dropping it.

Provider links and confirmed media IDs are stored in a private derived project
index, not in the document format. They are reusable only by the same provider,
for unchanged bytes and while any expiry remains valid.

The checked-in OpenArt export under `mcp/` is bootstrap and test evidence.
Runtime schema discovery remains authoritative when available. Cached catalog
data includes provider, source version and validation timestamp so stale or
unknown fields can be diagnosed without silently discarding them.

## Current implementation

The native GenAI panel discovers provider models and workflow schemas, supports
Image Create/Edit plus Video Create/References/Frames, base images, pasted/dropped/local visual references and
provider-defined fields without hard-coding each model form. Desktop owns
OpenArt and Higgsfield authentication, reference publication, project asset/job persistence,
result delivery and the managed local-provider process. Local workflows support
create/edit/inpaint; Remove Object submits a full-frame base plus selection mask
through the same provider-neutral boundary.

Provider transport modes are normalized before they reach the panel. OpenArt
`image2video` is the canonical Frames variant and `element2video` is References;
the adapter translates those names back only for schema, cost and generation
tool calls. Live OpenArt schemas are dereferenced and their mode-relevant
`allOf`/`oneOf`/`anyOf` branch is projected through existing LightTable panel
controls. Provider-fixed `const` fields remain recorded and submitted but are
not presented as editable controls. OpenArt image and video generation share
the same proven desktop publication cache and at-most-once job runtime; video
completion is stored in AI History and opens through the typed Video workspace.

Generation is currently hard-gated by an active project because submission,
jobs, outputs and recreate history use the project stores. Form/model discovery,
reference preparation, provider authentication and local provider lifecycle can
operate standalone. This coupling is audited in
[Project-mode feature gating](PROJECT_MODE_FEATURE_GATING.md) and remains an
explicit product decision.

Desktop execution uses a provider runtime registry with separate preparation,
paid submission and tracking phases. A restart never repeats a paid call:
preparation is marked interrupted, an uncertain submit becomes
`unknown-submit`, and only a persisted provider job ID may resume polling.

## Boundary enforcement

`scripts/verify-boundary.mjs` scans the GenAI package roots and rejects the
forbidden dependencies above. No exception is to be added to renderer or
editor-facade allowlists for GenAI.
