# MCP / Actions recovery checkpoint

Recorded: 2026-08-21
Branch: `main`
Repository baseline before this documentation checkpoint: `6e856df3`

## Why this checkpoint exists

This is the single operational handoff for the active Agent/Actions/MCP
program. A fresh agent must reconcile it with `npm run context:agent`, current
`HEAD`, the dirty worktree and newer owner direction. It replaces chat memory;
it does not override code, tests or canonical architecture.

## Proven current product state

- The semantic command service, Actions, Agent Access and MCP share canonical
  document/history/render owners. High-frequency paint, warp, transforms and
  sliders keep local preview/coalescing and publish bounded final intent.
- Actions has durable named version-5 sets, typed variables, prior-result
  bindings, rationales, dependency-aware step playback, reviewed per-command
  migrations and fail-closed one-undo playback for the atomic-compatible
  subset.
- The packaged external MCP route supports bounded discovery, structure/text/
  adjustment queries, editable text/vector/Layer Style construction, batches,
  events, revision-bound document/layer/mask/region previews and opaque
  native/PNG/JPEG/WebP/TIFF/PSD artifacts where admitted.
- `lighttable_palette` and `lighttable_layer_palette` lazily extract revision-
  checked palettes from the real final composite or one isolated rendered
  layer. The Color Picker uses the same document extractor; no preview decode
  or parallel MCP quantizer exists.
- Versioned MCP artist resources teach capability discovery, batch-first
  construction and existing native Bezier paths. They are guidance, not a
  second execution engine.
- A fresh Codex client completed OAuth and explicit read-to-edit approval,
  inspected `happy_birthday.png`, created a separate 1200x1200 document and
  built twelve editable raster/vector/text layers through MCP only. It checked
  the final revision-bound preview; the reference stayed unchanged and no paid
  provider was used.
- That cold-discovery run used 76 MCP roundtrips and exposed concrete gaps:
  unreliable text stroke/shadow realization, missing font discovery and text
  measurement, under-discovered batching/Bezier support and absent native SVG
  import. The guides address discovery only; they do not prove a faster guided
  rerun.
- The vector engine already owns editable cubic paths, live shapes, affine
  transforms, fills, gradients and strokes across `vector-core`,
  `vector-rendering` and `vector-webgpu`. SVG import/export does not exist; the
  proposed safe native subset is in
  `architecture/features/VECTOR_ENGINE_AND_SVG_IMPORT.md`.

## Current local MCP connection flow

The normal packaged route is:

1. **Preferences > Agent Access**;
2. select **Local test mode**;
3. enable **Allow agent connections**;
4. click **Connect Codex** and confirm browser authorization;
5. start or reload Codex once so it discovers the registration;
6. grant the exact client read, one-time edit or persistent edit permission.

The built-in MCP/OAuth endpoint is loopback-only. Local and online servers use
the same permission UI and exact-client grant model. A persistent grant is
OS-protected and bound to server ID, certificate fingerprint, client ID and
scopes; another or revoked identity cannot inherit it.

`npm run mcp:local:codex` remains useful as an isolated temporary-profile
security harness. It is no longer the normal iteration route. Existing Codex
sessions cannot discover a newly registered server dynamically.

## Automated evidence beneath the real Codex run

- `npm run smoke:mcp:local-codex` proves transport, approval, read-only preview,
  edit denial, revocation and explicit edit escalation.
- `npm run smoke:mcp:local-codex:a-z` proves a packaged editable four-layer
  composition, revision-bound correction, independent structure/text queries,
  invalid-schema/missing-target/stale-write rejection, reconnect continuity
  and PNG/JPEG/WebP/TIFF/native artifact signatures.
- Packaged Preferences smoke proves local one-switch start, automatic device
  pairing, stop and restart. Packaged outbound TLS smoke proves online pairing,
  runtime approval, edit, reconnect and revocation.
- These harnesses complement the owner-visible artist run; none alone proves
  the complete creative result or release readiness.

## Active tasks and remaining boundaries

- **Task 214** remains the program owner for complete user-action, Actions and
  MCP capability coverage.
- **Task 220** remains open for reviewed remote admission, permissions and
  representative packaged proof of every advertised class.
- **Task 221** remains open for meaningful semantic artist gaps through the
  existing application owners.
- **Task 264** remains open for a real Codex save/export, Actions-visible
  activity, independent packaged pixel/layer verification and explicit fresh-
  client invalid/stale/reconnect/cleanup evidence.
- **Task 282** remains open only for an explicit close/restart persistence check
  after `Always allow`. The owner has already confirmed that the new packaged
  Preferences/browser flow is materially better than terminal setup.
- **Task 277** is complete and packaged on Windows for native JPEG/PNG/WebP/TIFF
  open, flat representability-gated Save and OS Open With; macOS runtime
  qualification remains open.
- **Task 278** is research-only. Do not eagerly load all inference models or
  claim durable optimized artifacts before its measurements and lifecycle
  policy exist.
- **Tasks 300 and 301** are owner-supplied MLTD and SVG drafts. Treat them as
  active inputs, not approved architecture or permission to implement an
  underspecified file format/importer without reconciliation.
- Remove Object remains deferred until its product implementation is ready.
  Model/backend names such as SAM are implementation details behind stable
  product capabilities.

## Worktree and recovery guardrails

- Preserve the user's `.vscode/settings.json`; never stage it without explicit
  owner direction.
- `.titlebar-verify/` is generated renderer output; never stage it.
- `work/todo/task_300/` and `work/todo/task_301/` are owner-authored active task
  inputs versioned by this checkpoint. Preserve their intent and reconcile them
  with canonical architecture before implementation.
- The two Task 276 stashes are historical recovery copies of work already in
  Git. Do not apply them again.
- Duplicate empty todo directories reported by `context:agent` are queue-
  integrity warnings, not active work.
- User fixtures live under
  `D:\mediavibe\LightTableTestFiles\RandomFiles`; do not commit their contents
  or leak private paths into public reports.

## Next safe continuation

First complete Task 282's packaged close/restart persistence check. Then finish
Task 264 as one real Codex flow: construct or reuse an editable test document,
save/export through MCP, observe Actions/events, independently verify pixels and
editable layers through the packaged query/automation boundary, exercise
invalid/stale/missing/reconnect/cleanup cases and remove the local registration.

After that, use the evidence—not command counts—to choose the next Task
214/220/221 vertical. Highest-value known candidates are reliable text
stroke/shadow behavior, `font.list`/`font.search`, `text.measure`, lower-call
bulk/vector/SVG construction and align/distribute. Paid or externally metered
asset/generation flows require explicit configurable policy and user authority.
