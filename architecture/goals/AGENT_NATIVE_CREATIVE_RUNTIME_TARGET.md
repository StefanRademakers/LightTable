# Agent-native creative runtime target

Status: **canonical long-term product target**. This document describes the
destination, not current feature availability. Current/partial/target claims
must remain separated in
[`CURRENT_STATE_AND_ROADMAP.md`](../CURRENT_STATE_AND_ROADMAP.md).

## Product outcome

LightTable should become an AI-native creative runtime in which the normal UI,
keyboard and menus, Actions, workflows, MCP clients and internal or external
agents all consume the same semantic application capabilities.

The target is not remote control of the UI. It is:

> An agent that never sees LightTable's controls can still inspect, create,
> evaluate, correct and save the same real editable creative work as a human
> LightTable artist, within explicit permissions and review boundaries.

The benchmark workflow is deliberately demanding:

> Given a flat design reference, identity/reference assets and written
> direction, create several polished variants without changing the original;
> rebuild reasonable elements as native text, vector, mask, effect and
> adjustment content; generate only inherently raster assets; visually inspect
> and correct the result; and save a fully editable LightTable document.

Passing a command-count check or producing a flat image does not meet this
target.

## Local MCP artist practice benchmark

The owner-visible practice test is a fresh Codex session operating LightTable
only through the local MCP adapter. Codex starts outside the LightTable source
workspace and receives only:

- a flat visual reference;
- required canvas dimensions and a short design brief;
- explicitly supplied logos, photos or other identity assets;
- the instruction to build, inspect, correct and save the design using only
  advertised LightTable MCP capabilities.

The agent must discover capabilities, construct native editable layers, request
revision-bound previews, evaluate and correct visible problems, then produce a
native document and requested flat exports. Shell mutation, direct application
automation, test-only document APIs and LightTable source inspection do not
count as MCP execution. Afterward, packaged automation independently verifies
final pixels, dimensions, editable layer structure, command/Actions activity
and artifact signatures.

The first practice run deliberately contains no command recipes. It tests
whether capability discovery, schemas and errors are sufficient by themselves.
Examples can be added later as versioned MCP resources or agent skills that
teach layered design practice. They are a productivity and quality layer, not
a substitute for a coherent capability surface. Cold-discovery and guided-
example results must remain separate claims.

The first owner-visible cold-discovery run completed on 2026-08-21. A fresh
Codex client reconstructed a flat birthday reference as twelve editable native
layers in a separate 1200x1200 document and inspected a revision-bound final
preview without paid providers or direct application automation. This proves
the inspect -> plan -> layered construction -> preview boundary, not the full
save/export and independent-verification benchmark. The run required 76 MCP
roundtrips and failed to discover some existing batching and native Bezier
capabilities. Versioned on-demand artist guides were therefore added as a
separate guided-workflow layer; future cold and guided results remain distinct.

## Canonical architecture

```text
UI / keyboard / Actions / workflows / MCP / agents / future CLI
                              |
                  versioned capability surface
                              |
             queries + commands + gestures + events
                              |
         workspace / document / history / task authorities
                              |
       scene model / renderer / assets / AI provider adapters
```

The technical mutation primitive is a **semantic command**. The Actions panel
records, composes and replays commands; it is not a second mutation engine.
Queries observe bounded state. Gestures carry bounded high-frequency previews
and publish one semantic commit. Events report changes without forcing clients
to poll the entire application. MCP is an adapter over this surface and owns no
editor behavior.

## Required creative loop

Real agent use requires the complete loop:

```text
observe structure and preview
        -> plan
        -> act through semantic capabilities
        -> await publication/render
        -> observe again
        -> evaluate
        -> correct or branch
        -> save/export for user review
```

Commands plus queries provide automation. Adding revision-bound visual
previews enables an agent to evaluate its work. Examples and reusable skills
can later teach the agent how LightTable's tools are intended to be combined.

Preview is therefore first-class. The target surface includes bounded whole-
document, region and layer previews without moving the user's viewport or
shipping full-resolution pixels unnecessarily. Preview results identify their
document revision, render settings, color/profile context and artifact.

## Capability principles

1. **One implementation.** UI, Actions and MCP reach the same document,
   history, renderer, task and host-I/O owners.
2. **Editable first.** Native text, shapes, gradients, effects, masks and
   adjustments are preferred to flattened generated output.
3. **Semantic intent.** Expose `layer.setBlendMode`, not `clickAt` or
   `dragSlider`.
4. **Stable identity.** Commands target stable object IDs or explicit
   result-bindings. Display names are not identity.
5. **Explicit coordinates.** `document-px` is the canonical public coordinate
   space: top-left origin, +X right, +Y down, floating-point units. Layer-local
   and document-normalized spaces are explicit alternatives, never implicit
   conversions.
6. **Reversible work.** Logical operations are inspectable and undoable;
   bounded atomic batches publish once or not at all.
7. **Safe concurrency.** Revision checks reject stale work. Agents never
   silently overwrite newer user changes.
8. **Bounded execution.** Large pixels/files use artifacts; long work uses
   cancellable tasks; batches, samples, payloads, time and concurrency are
   limited.
9. **Discoverability.** Capabilities expose version, category, availability,
   parameter/result schemas, effects, history behavior, permissions, examples
   and actionable exclusion reasons.
10. **Inspectability without hidden reasoning.** Agent activity may carry a
    short user-facing intent or rationale. LightTable does not persist private
    chain-of-thought or provider-internal reasoning traces.
11. **Provenance.** Generated assets retain provider/model, prompt or operation
    parameters, references, seed/version where available and creator origin,
    subject to privacy and retention policy.
12. **Explicit authority.** Read, edit, generation, asset, export, overwrite,
    filesystem and network permissions remain separable and revocable.

## Paid and externally metered capabilities

Asset acquisition, hosted generation and any other operation that can consume
credits or create an external charge are disabled by default and always user-
configurable. They must never become an implicit fallback for an ordinary
creative command.

The capability surface reports whether such an operation is configured and
available, its cost class, whether approval is required and an actionable
withheld reason. Provider/model choice, per-call/session/project budgets and
approval thresholds belong to user or project policy. Supported policies must
include `local-only`, `free-only` and `never-generate`. Credentials remain in
the host/provider boundary and are never returned to MCP clients. A failed or
unavailable provider must not silently fall back to a more expensive provider.

The initial local artist benchmark runs in `local-only` mode: no paid
generation, stock purchase or metered network provider. This isolates whether
Codex can act as an artist with LightTable's native layer, vector, text, paint,
mask and grading capabilities.

## Interaction and performance contract

Not every UI event is a command. Exposing raw event streams would create
latency, history spam, recorder growth and denial-of-service risk.

| Interaction | Capability form | Publication/history |
| --- | --- | --- |
| rename, visibility, discrete property | immediate command | one result / one logical entry |
| slider, transform, color drag | bounded preview gesture | many transient updates, one commit |
| brush or selection stroke | bounded sampled gesture | one stroke transaction |
| multi-object construction | atomic batch or workflow | publish once or fail without publication |
| generation, segmentation, large export | cancellable task | progress/events plus artifact result |
| document inspection | bounded query | no mutation/history |
| rendered feedback | cached revision-bound artifact | no viewport mutation |

Unchanged previews should be reused. High-frequency paths must not serialize
through MCP per pointer sample, trigger a full React/render/history cycle, or
record playback back into an active Action.

## Target capability domains

The shared surface ultimately covers meaningful artist operations across:

- workspace, documents, save/export and creative variants;
- scene graph, groups, layers, ordering, clipping and transforms;
- raster placement, paint and pixel operations;
- editable text, fonts, paragraphs and layout;
- vectors, paths, fills, gradients and strokes;
- selections, masks, subject/object intelligence and matte refinement;
- Grade, adjustment layers, Lens FX, filters and Layer Styles;
- assets, fonts, generated content and provenance;
- history, transactions, tasks, cancellation and events;
- bounded structural queries, scopes and render previews;
- capability discovery, examples, learned workflows and version negotiation.

Semantic layout constraints such as align, distribute, relative placement and
safe-area containment are valuable agent-facing conveniences, but they must
resolve through native scene/transform operations rather than form a parallel
document model.

## Creative variants and learning

Undo/redo is not sufficient for autonomous exploration. The long-term target
includes explicit snapshots or branches so an agent can create alternatives
without destructively changing the only document state. Branching semantics,
persistence cost and merge/review UX are unresolved and must be designed before
implementation.

Recorded human workflows may later become parameterized skills. A reusable
example contains before/after evidence, command sequence, document structure,
explanation, tags and compatibility requirements. Examples are executable,
versioned product knowledge—not prose copied into a giant system prompt.

## Agent-facing recovery and activity

Errors are structured and actionable: stable code, affected target, reason,
current revision/capability where relevant, and safe recovery suggestions.
Agents must not parse UI toast text or retry destructive work blindly.

The Actions surface is also the intended visible command/workflow stream for
human and agent activity. It should group logical transactions, show progress,
failure and cancellation, identify origin, and let the user inspect or replay
supported steps. An optional short rationale explains user-facing intent; it is
not a storage channel for private model reasoning.

AI generation remains a provider capability rather than an alternate editor.
Its output enters the normal asset/layer system with provenance, then uses the
same transform, mask, Grade, effect, history and export operations as imported
content. See
[`../features/GENAI_BOUNDED_CONTEXT.md`](../features/GENAI_BOUNDED_CONTEXT.md).

## Current relationship to the target

**Current foundation:** LightTable has a versioned semantic command service,
stable IDs, optimistic revisions, bounded artifacts, atomic batches, async task
events and document-space gestures. The Actions surface discovers, records and
replays part of that command set. Agent Access and the MCP server expose a
permission-gated subset, including editable text/vector construction, Layer
Styles, bounded pixel Copy/Copy Merged/Paste and real renderer preview/export
paths. Pixel clipboard Actions regenerate session-local artifacts during replay
instead of persisting raster bytes or host paths. Final-document and isolated-
layer palettes provide compact on-demand color analysis, and versioned artist
guides advertise batch-first construction plus existing native Bezier support.
The packaged Preferences flow starts the local MCP server and Codex browser
authorization without terminal command copy/paste; local and online connections
share exact-client read/one-time-edit/persistent-edit grants.

**Partial:** command coverage is incomplete; current catalog commands have
shared machine schemas, while several artist operations still lack admitted
semantic commands. Actions now has durable named sets, typed variables,
explicit result bindings, bounded user-facing step rationales, gesture-level
commits, task-aware stepwise playback and explicit one-undo playback for the
bounded atomic subset. Explicit consecutive per-command migrations now guard
saved workflows across reviewed schema changes, but teach mode and richer
workflow authoring remain open. Structural layer pages plus whole-document/layer/mask previews now
cover a bounded inspection baseline including final-composite regions and an
active-layer content dispatcher. Every current adjustment presentation now has
bounded module-registry-backed inspection for document, layer and attached
owners. Detail sharpening/noise reduction now has a bounded mutation schema;
the remaining non-basic adjustment mutation families remain open. Equivalent
UI/Actions/MCP outcomes are not
yet broadly proven. The first real fresh-Codex construction proved reference
inspection, twelve editable layers and revision-bound preview, but not the
complete save/export, independent-verification and failure/reconnect/cleanup
acceptance.

**Target only:** reference decomposition, autonomous visual correction,
editable-first reconstruction, creative branching, teach mode/skill library,
full provenance, semantic layout constraints and a genuinely headless core.

## Acceptance ladder

Progress is measured by representative outcomes, not catalog size.

1. **Shared command proof:** UI, Actions and MCP produce equivalent canonical
   state and history for representative discrete edits.
2. **Interactive proof:** slider, transform and paint paths retain responsive
   preview behavior and publish one bounded semantic result.
3. **Artist construction proof:** an agent builds editable text/vector/raster
   compositions, uses result-bindings, inspects state and exports/reopens them.
4. **Visual iteration proof:** an agent requests revision-bound previews,
   detects a visible problem and corrects the relevant native operation.
5. **Editable reconstruction proof:** a flat reference is recreated as a useful
   layered document, with separately reviewed visual quality and editability.
6. **Creative autonomy proof:** multiple non-destructive variants are created,
   inspected and handed to the user with provenance and understandable steps.

Each proof includes invalid input, stale revisions, unavailable resources,
missing fonts/models, cancellation, timeout, reconnect, bounded payloads,
partial failure and user/agent concurrency. Visual metrics support review but
never replace inspection of representative images and editable structure.

## Non-goals and cautions

- No parallel MCP, Actions or AI document engine.
- No unrestricted JSON patches, DOM selectors or screen-coordinate automation
  as the primary capability surface.
- No claim that every UI presentation action belongs in the agent API.
- No default flattening of content merely because generation is easier.
- No unbounded autonomous loop, background renderer or network/filesystem
  authority.
- No headless claim while execution still depends on a mounted desktop/WebGPU
  editor.
- No identity-reference workflow without explicit user authority, provider
  policy, privacy handling and visible provenance.
- No single aggregate similarity score as proof of creative or visual parity.

## Ownership and related contracts

- Current implementation boundary and rollout:
  [`../integrations/LIGHTTABLE_MCP_V1.md`](../integrations/LIGHTTABLE_MCP_V1.md)
- Embedded permission/session boundary:
  [`../integrations/EMBEDDED_AGENT_ACCESS.md`](../integrations/EMBEDDED_AGENT_ACCESS.md)
- Detailed supporting research and implementation questions:
  [`../research/lighttable_ai_agent_mcp_architecture.md`](../research/lighttable_ai_agent_mcp_architecture.md)
- Performance constraints:
  [`../PERFORMANCE_CONTRACT.md`](../PERFORMANCE_CONTRACT.md)
- Document and scene authority:
  [`../DOCUMENT_AND_SCENE_MODEL.md`](../DOCUMENT_AND_SCENE_MODEL.md)
- Active command/Actions/MCP coverage work:
  [`../../work/todo/task_214_complete_action_command_mcp_coverage/task.txt`](../../work/todo/task_214_complete_action_command_mcp_coverage/task.txt)
- Expanded owner design brief and provisional scale/preview-transport direction:
  [`mcp_future_usage_target_v3.md`](./mcp_future_usage_target_v3.md)

The owner-supplied `D:\mcp_future_usage_target.md` was reconciled into this
contract on 2026-08-20. Its ambition is accepted with the terminology,
performance, security, truthfulness and acceptance constraints above.
