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

Then read, in this order:

1. the reset card and relevant system sections in
   [QUICKSTART.md](QUICKSTART.md);
2. [CURRENT_STATE_AND_ROADMAP.md](CURRENT_STATE_AND_ROADMAP.md);
3. the complete active task package under `work/todo/`, including fixtures;
4. only the contracts selected by the routing table below.

Do not preload `work/done/`, `architecture/reference/`, `obsolete/`, every test
or every source file. Search those collections only to answer a concrete
question. Context is a working set, not a measure of diligence.

## Phase 2: classify the requested change

| Change | Read first | Trace to |
| --- | --- | --- |
| canvas interaction, tool or shortcut | [INPUT_TOOLS_AND_HISTORY.md](INPUT_TOOLS_AND_HISTORY.md) | input router -> document controller -> preview -> one history commit |
| transform, bounds, masks or layer semantics | [DOCUMENT_AND_SCENE_MODEL.md](DOCUMENT_AND_SCENE_MODEL.md) | canonical operation -> scene graph -> renderer contract -> export |
| compositor, shader, effect or performance | [RENDERING_AND_PROCESSING.md](RENDERING_AND_PROCESSING.md) and [PERFORMANCE_CONTRACT.md](PERFORMANCE_CONTRACT.md) | dirty domain -> retained resource owner -> encoder stage -> telemetry |
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
continue until the queue is empty or genuinely blocked.

At handoff, report the outcome, evidence run, known limitations and affected
files. Do not claim success from code inspection alone when a relevant test can
be run, and do not hide pre-existing failures as if they were introduced by the
current change.
