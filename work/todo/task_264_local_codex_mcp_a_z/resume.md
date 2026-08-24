# MCP / Actions recovery checkpoint

Recorded: 2026-08-23
Branch: `main`
Repository baseline before this documentation checkpoint: `bb03da24`

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
- That cold-discovery run used 76 MCP roundtrips and exposed concrete gaps at
  that checkpoint: unreliable text stroke/shadow realization, missing font
  discovery and text measurement, under-discovered batching/Bezier support and
  absent native SVG import. SVG import has since been implemented; the text and
  discovery gaps plus a faster guided rerun remain unproven.
- The vector engine owns editable cubic paths, live shapes, affine transforms,
  fills, gradients, strokes and bounded vector clips across the reusable vector
  packages. SVG Open/Place/import/paste/Actions/MCP and symmetric export now
  share secure normalization and canonical document owners. Patterns, embedded
  images, imported text layout, richer masks and compound clip booleans remain
  explicit gaps documented in
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
- **Task 300** is an owner-supplied MLTD draft parked in `work/todoLater`; the
  current roadmap defers format freeze until the document/resource model and
  migration policy are mature.
- **Task 301** completed the initial SVG importer. Tasks 303, 305 and 306
  completed the renderer bake-off, retained hybrid integration and warm
  first-useful-pixel pass; their historical reports now live under `work/done`.
- Remove Object remains deferred until its product implementation is ready.
  Model/backend names such as SAM are implementation details behind stable
  product capabilities.

## Worktree and recovery guardrails

- Preserve the user's `.vscode/settings.json`; never stage it without explicit
  owner direction.
- `.titlebar-verify/` is generated renderer output; never stage it.
- `work/todoLater/task_300/` is owner-authored parked design input. Preserve its
  intent and reconcile it with canonical architecture before implementation.
- The two Task 276 stashes are historical recovery copies of work already in
  Git. Do not apply them again.
- Duplicate empty todo directories reported by `context:agent` are queue-
  integrity warnings, not active work.
- User fixtures live under
  `D:\mediavibe\LightTableTestFiles\RandomFiles`; do not commit their contents
  or leak private paths into public reports.

## Next safe continuation

### Design-pass priorities (24 August 2026)

Keep this list outcome-driven; do not create a task per tool or duplicate it in
another MCP-only scene model.

1. **Finish the real artist acceptance loop.** Complete native save plus flat
   export, inspect Actions/events, independently verify pixels and editable
   structure, and exercise stale/missing/reconnect/cleanup behavior. Separately
   close Task 282's one remaining `Always allow` restart check.
2. **Make text measurable and predictable.** Add bounded `font.list`/search and
   `text.measure` queries with actual font/substitution status, logical/ink
   bounds and overflow. Fix the observed text stroke/shadow realization before
   teaching agents to rely on those styles.
3. **Add semantic design layout.** Implement explicit layer reparent/insertion,
   absolute reorder, align/distribute and multi-layer transform/bounds queries.
   These must resolve through the canonical scene graph and transform owners,
   not through UI coordinates.
4. **Reduce construction roundtrips.** Build on `command.batch`, result bindings
   and the 32 MiB SVG route for lower-call bulk vector/text creation. Measure a
   guided reconstruction rerun against the 76-call cold baseline before adding
   another coarse dedicated tool.
5. **Improve visual evaluation.** Expose bounded region statistics/scopes,
   alpha occupancy and clipping/contrast diagnostics alongside revision-bound
   previews and palettes. Layer/text/vector queries now return shared
   document-space `document` and conservative `visual` bounds; null visual
   bounds deliberately mean the client must not assume safe rejection.
6. **Close editable SVG/design gaps by value.** Patterns, embedded images,
   imported editable text, richer masks and compound clip/boolean behavior are
   the largest remaining reference-reconstruction gaps. Preserve the same
   canonical vector packages used by UI, Actions, export and MCP.
7. **Finish reviewed remote admission.** Keep every withheld capability and
   permission reason machine-readable, and prove representative denial,
   cancellation, reconnect and oversized-input cases. Generation/network/cost
   authority remains separate and never becomes an implicit design fallback.

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
