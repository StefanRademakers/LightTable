# AI coding-agent onboarding

This is the operational entry point after a fresh session or context collapse.
It tells an agent how to recover enough context to make a safe change without
loading the repository, completed task archive or full architecture catalog.

The deeper technical model is in [QUICKSTART.md](QUICKSTART.md). Current code
and tests remain authoritative; see [README.md](README.md) for the complete
authority order.

## Phase 1: recover the live situation

From the repository root, run:

```powershell
npm run context:agent
```

This read-only command reports the current commit, dirty paths, active task
packages and workspace packages. Never assume a worktree is clean and never
overwrite changes merely because their purpose is not immediately obvious.

The command also reports the last 72 hours of commits, recoverable Git stashes,
discoverable `resume.md` checkpoints and queue-integrity warnings. This is live
recovery evidence, not architecture. Read every reported resume checkpoint and
reconcile its recorded baseline and next step with current `HEAD`, stashes and
the dirty paths before trusting it. A resume records interrupted work; it never
overrides newer code, tests or owner direction.

Then read, in this order:

1. every resume checkpoint reported by `context:agent`;
2. the reset card and relevant system sections in
   [QUICKSTART.md](QUICKSTART.md);
3. [CURRENT_STATE_AND_ROADMAP.md](CURRENT_STATE_AND_ROADMAP.md);
4. the complete requested/current task package under `work/todo/`, including
   fixtures;
5. only the contracts selected by the routing table below.

A directory under `work/todo/` is actionable only when it contains a readable
`task.txt`. An empty directory, or a package name duplicated in `work/done/`, is
a queue-integrity warning rather than evidence of open product work. Resolve or
record those warnings; do not inflate scope or completion counts from directory
names alone.

Do not preload `work/done/`, `architecture/reference/`, `obsolete/`, every test
or every source file. Search those collections only to answer a concrete
question. Context is a working set, not a measure of diligence.

### Current Agent/Actions/MCP recovery capsule

When the recovered work concerns Agent Access, Actions or MCP, read these after
the reported resume checkpoint:

1. [LightTable MCP v1](integrations/LIGHTTABLE_MCP_V1.md) for the current
   command/query/permission boundary;
2. [Local Codex acceptance](integrations/LOCAL_CODEX_MCP_ACCEPTANCE.md) for the
   shortest packaged practice flow and the separate isolated harness;
3. [Agent-native creative runtime target](goals/AGENT_NATIVE_CREATIVE_RUNTIME_TARGET.md)
   for the long-running product outcome;
4. Tasks 214, 220, 221 and 264 for the remaining program work.

Current reset fact, updated 2026-08-23: a fresh Codex client has already inspected a
reference and built a separate twelve-layer editable text/vector composition
through MCP only. Whole-document and isolated-layer palettes, bounded previews,
artist workflow guides, batch construction and native bitmap artifacts exist.
The ordinary local connection flow now starts inside **Preferences > Agent
Access** and no longer requires terminal command copy/paste. The full Task 264
save/export, independent verification, error/reconnect and cleanup acceptance
is still open; do not turn the successful first construction into a claim that
all artist capabilities or the complete A-Z benchmark are finished. Automatic
startup of the direct embedded bridge now retries bounded loopback ports
instead of treating one occupied port as a permanent Agent Access failure.

### Current renderer/editor recovery capsule

When the recovered work concerns rendering, SVG, document startup, canvas
tools or workspace state, use this reset state before reading historical task
reports:

- **Current, 2026-08-24:** LightTable has one shipping **hybrid vector
  renderer**. There are no normal `:vello` development/package switches and no
  per-document backend mode. `run_clean.bat`, `run_dev.bat`, `run_release.bat`,
  `build.bat`, `npm run dev:desktop` and `npm run package:desktop` all build the
  same hybrid architecture.
- A pure `RenderIslandPlanner` projects independently editable canonical vector
  layers into the minimum currently representable compositing islands. Stable
  runtime resource IDs, retained cross-layer PaintScene fragments and Vello
  Rust scenes are derived resources; they never merge or rewrite document
  layers.
- Backend admission is **per island**. Eligible vector islands use
  retained Vello; unsupported islands and specialized editor paths use the
  native LightTable WebGPU implementation on the same shared `GPUDevice`.
  Inverted clips, unsupported masks/effects and other explicit boundaries must
  fall back or fail visibly, never silently lose semantics.
- Island resources have active/warm/cold/evicted states. Visibility affects
  compositing, not canonical ownership. A hidden island stays warm; memory
  pressure may evict its texture while retaining the JS projection and Rust
  scene; deleted canonical content releases both.
- Pan and zoom are presentation-only. They must not rebuild PaintScene,
  retessellate document geometry or recompose document pixels. Retained vector
  geometry is adaptive to authored/document scale, not viewport zoom.
- Untrusted SVG uses `@lighttable/vector-svg-normalizer` (pinned, local-only
  `usvg` WASM) before the editable `@lighttable/vector-svg` codec. The current
  product routes Open, Place/import, paste, Actions and MCP through the shared
  boundary. Linear/radial gradients, opacity groups and bounded local vector
  clips are current; patterns, filters, SVG text/images and richer mask/boolean
  semantics remain incomplete.
- Warm `VORTEXT.SVG` time-to-first-useful-pixel is proven below 500 ms in five
  packaged runs (428--446 ms). A conservative transient browser-rendered SVG
  preview may provide those first pixels, but it is renderer-only, cannot enter
  history/save/document state, and must be replaced by the final editable
  canonical Vello result. Cold GPU startup and final edit-readiness remain
  separate performance work.
- Document data and editor/workspace state are separate authorities. Switching
  document tabs or Dockview presets must not mutate pixels/layers. Workspace
  layout and the active tool are application/editor state; canonical content
  changes only through an explicit user, command, Action or MCP operation.
- Recent stability fixes preserve raster pixels across renderer rebinding,
  overlap bitmap decode with GPU startup, preserve Copy Merged color through
  the OS clipboard, invalidate attached adjustments, keep transform gizmos
  alive after gestures/picks, use tight multi-layer bounds, restore
  selection-aware pixel Invert and support topmost alpha-aware Shift-click
  canvas layer selection.
- Source preparation and export now carry the document/session/renderer
  generation they were started against. A late decode, preview, export or
  recovery callback is rejected after a renderer rebind instead of publishing
  into the newly active document. Prepared source, document and history state
  publish as one session snapshot rather than three observable partial states.
- Pointer-hot group transforms and partial vector drags keep their transient
  transform in retained renderer state until pointer-up. React and canonical
  state receive one final semantic commit. Settled composites are reused while
  moving layers, and floating controls cannot leak keyboard commands into the
  canvas command router.
- `layer.rasterize` is the universal semantic finalization command for every
  admitted unlocked layer type. Layer-panel UI, Actions and MCP use the same
  command/capability decision and the packaged route-equivalence gate compares
  canonical state, history and pixels after replay.
- Scope canvases explicitly wake and resize when a previously hidden section
  or workspace becomes visible. The packaged scopes gate verifies real signal
  in Hue Distribution, RGB Parade and Vectorscope, then confirms that scope UI
  changes leave canonical revision, history and document pixels unchanged.
- The same stabilization pass made command availability independent from a
  hidden editor mount, preserved application services through React Strict Mode
  reconnects, made workspace preset switching deterministic, rejected stale
  recovery publication after Save and restored an explicit recovery-discard
  workflow. Treat these as regression boundaries, not incidental fixes.

Archived Task 303 is a dated backend bake-off; archived Task 305 and current
code supersede its former "current backend by default" decision. Read their
historical measurements for evidence, not as today's launch configuration. Read
[Vector system](VECTOR_SYSTEM.md),
[Vector engine and SVG import](features/VECTOR_ENGINE_AND_SVG_IMPORT.md),
[Rendering and processing](RENDERING_AND_PROCESSING.md) and
[Performance contract](PERFORMANCE_CONTRACT.md) for the durable contracts.

## Phase 2: classify the requested change

| Change | Read first | Trace to |
| --- | --- | --- |
| canvas interaction, tool or shortcut | [INPUT_TOOLS_AND_HISTORY.md](INPUT_TOOLS_AND_HISTORY.md) | input router -> document controller -> preview -> one history commit |
| transform, bounds, masks or layer semantics | [DOCUMENT_AND_SCENE_MODEL.md](DOCUMENT_AND_SCENE_MODEL.md) | canonical operation -> scene graph -> renderer contract -> export |
| compositor, shader, vector backend, effect or performance | [RENDERING_AND_PROCESSING.md](RENDERING_AND_PROCESSING.md), [VECTOR_SYSTEM.md](VECTOR_SYSTEM.md) and [PERFORMANCE_CONTRACT.md](PERFORMANCE_CONTRACT.md) | dirty domain -> render island/resource owner -> encoder stage -> telemetry |
| visible UI, panel, workspace or accessibility | [UI_WORKSPACE_AND_DESIGN_SYSTEM.md](UI_WORKSPACE_AND_DESIGN_SYSTEM.md) and [ACCESSIBILITY_KEYBOARD_AND_FOCUS.md](ACCESSIBILITY_KEYBOARD_AND_FOCUS.md) | shared primitive/model -> projected panel -> desktop smoke |
| PSD, PDF, color or format behavior | [PHOTOSHOP_INTERCHANGE.md](PHOTOSHOP_INTERCHANGE.md) or [PDF_OPEN_AND_EXPORT_AUDIT.md](PDF_OPEN_AND_EXPORT_AUDIT.md) | importer model -> representability -> worker/export -> real oracle |
| MCP, Agent Access or command exposure | [integrations/LIGHTTABLE_MCP_V1.md](integrations/LIGHTTABLE_MCP_V1.md) | stable command ID -> validation/permission -> driver -> adapter |
| GenAI, local inference or model lifecycle | [features/GENAI_BOUNDED_CONTEXT.md](features/GENAI_BOUNDED_CONTEXT.md) | provider contract -> host process/auth -> asset/provenance -> document command |
| save, recovery, host or portability | [HOSTS_IO_AND_PORTABILITY.md](HOSTS_IO_AND_PORTABILITY.md) and [RELIABILITY_AND_VERIFICATION.md](RELIABILITY_AND_VERIFICATION.md) | host capability -> session revision -> durable result/failure |
| licensing, release or distribution | [COMMERCIAL_OPERATIONS_AND_OUTAGE_RUNBOOK.md](COMMERCIAL_OPERATIONS_AND_OUTAGE_RUNBOOK.md) and [SUPPORTED_HARDWARE_AND_SOAK_GATE.md](SUPPORTED_HARDWARE_AND_SOAK_GATE.md) | policy contract -> signed/packaged artifact -> exact-build evidence |

Before editing, be able to answer:

- What is the canonical state owner?
- What is runtime-only or reconstructable state?
- Which document/session does the operation address?
- Which semantic revision or dirty domain changes?
- Where are cancellation, disposal and stale-result rejection owned?
- What is one meaningful undo unit?
- Which narrow test proves the behavior, and which wider boundary could regress?

If these answers are unclear, trace one existing vertical slice. Do not invent
a second state path to avoid understanding the first one.

## Phase 3: preserve the engineering character

LightTable favors abstraction where it creates a stable semantic boundary, but
permits guarded, specialized fast paths inside that boundary. The goal is not
maximum indirection; it is reusable ownership with desktop-class latency.

- React owns chrome and low-frequency projection, not pointer-frequency canvas
  feedback or renderer state.
- Gizmos, selections, previews and animation belong in retained GPU overlays
  with narrow invalidation. Existing DOM/React hot paths are debt, not examples.
- The canonical document never contains DOM nodes, GPU handles or host paths.
- WebGPU performs high-volume rendering; workers/Wasm/Rust own suitable codecs,
  shaping and bounded analysis. CPU readback in a hot path requires evidence.
- Vello and native LightTable WebGPU are cooperating backends behind one hybrid
  renderer, not user modes. Backend-specific state is disposable projection;
  canonical vectors, PaintScene capability reports and compositor order remain
  authoritative.
- Preview and final quality may differ deliberately. Pointer-up produces one
  semantic, undoable commit.
- Optional resources are lazy, revision-keyed, cancellable and explicitly
  disposed. Device loss and late async completion must be safe.
- A generic package is valuable only when it preserves these properties and
  has a real consumer. Do not replace a direct fast path with abstraction churn.

## Phase 4: implement and prove a vertical slice

Prefer the smallest owner-correct slice that completes the behavior:

```text
intent / stable command
  -> validation and explicit document identity
  -> canonical mutation or bounded task
  -> one history entry
  -> smallest dirty domain
  -> retained renderer realization
  -> projected UI / artifact / export
```

Start with the nearest unit test. Widen according to the changed boundary; use
the verification map in [QUICKSTART.md](QUICKSTART.md#verification-map). A UI
handler returning quickly does not prove responsive rendering, and a synthetic
canvas screenshot does not prove Photoshop parity or lifetime safety.

When a contract changes, update canonical architecture in the same milestone.
Do not turn an implementation observation, active bug or temporary workaround
into a permanent design rule.

## Commercial stop check

Passing technical tests never authorizes a paid-release claim. Before wording
work as commercially ready, distinguish all of the following:

- exact build and supported hardware evidence;
- data-loss, crash recovery and rollback behavior;
- installer, signing, update and downgrade operations;
- licensing/activation, purchase restoration and outage behavior;
- privacy, diagnostics, security review and Agent Access permissions;
- third-party/model licenses, notices and redistribution rights;
- accessibility, external beta evidence and owner visual acceptance;
- pricing, tax, refunds, support and upgrade policy.

The current product is a strong technical preview. Production entitlement is
not implemented, model disclosures are incomplete, platform qualification is
not broad enough and owner/legal decisions remain. Local editing, save, export
and recovery are intended to remain available without a live licensing server.

## Queue mode and completion

An ordinary request authorizes the requested change only. The explicit command
to work all todos activates the persistent queue contract in
[`work/README.md`](../work/README.md): finish tasks in order, verify, update
durable architecture, commit the milestone, move it to `work/done/` and
continue until the queue is empty, genuinely blocked, or the mandatory
eight-hour owner checkpoint is due. Persistence follows the autonomous-result
loop in that contract: implement, exercise the real flow, assess the net
product result, and redirect when a metric or approach stops serving the
product goal. A new autonomous period begins only after owner review or an
explicit instruction to continue.

At handoff, report the outcome, evidence run, known limitations and affected
files. Do not claim success from code inspection alone when a relevant test can
be run, and do not hide pre-existing failures as if they were introduced by the
current change. Do not move work to `done/` when its defining external or user
flow remains untested; record it as `manual validation required` in `todo/`
instead.

The owner leads product direction and expects decision-grade information, not
agreement for its own sake. Follow the evidence and decision hierarchy in
[`work/README.md`](../work/README.md): conclusion first, then facts,
interpretation, uncertainty, consequences, options and a reasoned
recommendation. Challenge weak product or technical choices directly. Count
tests and research as supporting work only; the complete user flow and the
quality it protects remain the result.
