# GenAI bounded context

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
@lighttable/desktop
  OAuth/PKCE and loopback callback
  Electron safeStorage
  provider transport and filesystem output
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
- `genai-openart` may import `genai-core` and the MCP client. It may not import
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
  `aiHistory` location (default `AiRenders/History`) before editor mutation.
- Image-edit results are then placed as the top layer of the active document.
- Image-create results are then opened as a new document.
- Remote completion, durable local storage and editor placement are distinct
  stages. A placement/open failure must not discard or resubmit a paid render.

## Reference publication

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

OpenArt's MCP generation contract accepts reachable media URLs. Its
`openart_upload_pick` command is a host-specific interactive upload widget; it
does not accept native file bytes or a local path. StoryBuilder therefore
publishes its S3-backed project media through a short-lived presigned download
URL before constructing `visualReferences`.

LightTable follows the same boundary through a desktop-owned reference
publisher. React supplies only opaque project asset IDs. The desktop resolves
and validates the asset, publishes it through a configured first-party relay
or reuses a still-valid provider link, and hands only HTTPS links to the
provider adapter. Local paths, `file:` URLs, localhost URLs and data URLs are
never submitted. Until a local asset has a reachable link, generation fails
before the paid provider call instead of silently dropping the reference.

Provider links are stored in a private derived project index, not in the
document format. Generated OpenArt results retain their remote link for direct
reuse while it remains valid. Locally authored assets require the reference
publisher/relay and may not be mistaken for already-uploaded provider assets.

The checked-in OpenArt export under `mcp/` is bootstrap and test evidence.
Runtime schema discovery remains authoritative when available. Cached catalog
data includes provider, source version and validation timestamp so stale or
unknown fields can be diagnosed without silently discarding them.

## Initial vertical slice

The first slice surfaces one native GenAI panel and one real OpenArt connection
state. It intentionally contains no model-specific form code. Catalog and
generation functionality are added only after the panel and secure host bridge
are independently testable.

## Boundary enforcement

When the two packages are created, `scripts/verify-boundary.mjs` must scan both
source roots and reject the forbidden dependencies above. No exception is to
be added to renderer or editor-facade allowlists for GenAI.
