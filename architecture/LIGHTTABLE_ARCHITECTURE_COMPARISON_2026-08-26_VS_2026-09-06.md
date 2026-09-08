# LightTable architecture comparison — 2026-08-26, 2026-09-02 and current baseline

Comparison prepared: 2026-09-08  
26 August baseline: `a8ca4d931c660d9f1f61e882a556327b10d16447`  
2 September baseline: `0298946f31cf9b19b6d490e8aa63fb61db96c566`  
Current committed baseline: `cce15c7c557a756fc3aabf2777d6bd5a8e8b643b`

## Bottom line

The new 26 August audit changes the timeline, but not the main architectural verdict.

Document-bound state, document history, a mutation controller, canonical command handlers and a document resource repository already existed on 26 August. The present instability was therefore not caused by one sudden decision after 2 September to “move state onto the document.” That decision was architecturally reasonable and had already been made.

The persistent problem across all three snapshots is that document state was never made the sole semantic authority through an enforced transaction boundary. Renderer state, GPU resources, mounted command ports and tool sessions continued to perform meaningful parts of edits. Later stabilization work added guards, rollback and publication mechanisms around that split instead of first eliminating the split.

The timeline has two distinct phases:

1. **26 August to 2 September:** a very broad expansion across UI, filters, GenAI, selections, panels, tools and product workflows. This is where the largest surface-area increase occurred.
2. **2 September to current:** intensive repair of selection, transform, history, resources and document transactions. These changes address real defects and contain reusable work, but they also increased coordination complexity before one vertical workflow proved the architecture.

Neither historical state is a clean rollback target. The 26 August state is the better pre-expansion behavioral oracle; 2 September is the better post-expansion/pre-stabilization oracle; current main contains the most safety mechanisms. The correct comparison is selective, not “pick one commit and discard the rest.”

## Quantitative timeline

### Repository scale

| Area | 26 Aug | 2 Sep | Current | 26 Aug → current |
|---|---:|---:|---:|---:|
| Runtime/source files | 1,022 | 1,127 | 1,143 | +121 |
| Runtime physical lines | 202,048 | 210,345 | 216,067 | +14,019 |
| Runtime nonblank lines | 190,227 | 198,428 | 203,943 | +13,716 |
| Test files | 655 | 658 | 665 | +10 |
| Test physical lines | 72,773 | 73,811 | 76,104 | +3,331 |
| Script files | 223 | 226 | 227 | +4 |

### Git change volume

| Period | Commits | Changed files | Insertions | Deletions |
|---|---:|---:|---:|---:|
| 26 Aug → 2 Sep | 62 | 598 | 22,851 | 11,319 |
| 2 Sep → current | 38 | 300 | 13,394 | 4,226 |
| 26 Aug → current | 100 | 748 | 35,783 | 15,083 |

The first week changed twice as many files as the later repair phase. The current crisis should therefore not be analyzed only through the recent selection/transaction edits: a large amount of new product and UI surface landed immediately before them.

## Phase 0 — what already existed on 26 August

The snapshot already had:

- 36 left-toolbar tools;
- document-scoped canonical state and history;
- immutable document snapshot publication;
- a transaction-shaped document mutation controller;
- document-level GPU resource repositories;
- mounted and canonical command ports;
- Actions and MCP command infrastructure;
- paint, vector, text, filter and PDF packages;
- grade/Lens FX, filters and layer styles;
- broad desktop/web format support;
- projects and GenAI integrations.

It did not yet have the shared `ui` package/demo or the selection paint brush, and Actions/History had only just reached their “finished workflows” commit. This was a substantial product already, not a small clean core.

Most importantly, the central authority problem already existed. `DocumentSession` owned semantic data, but `LayerDocumentRenderer` also executed selection, clipboard, mask and resource-replacement operations. History retained renderer resources. The command registry could mix mounted and canonical properties. Tool behavior remained distributed across the overlay and specialized controllers.

## Phase 1 — 26 August to 2 September

This phase combined many independent initiatives:

- repeated Actions and History fixes;
- layer hierarchy, visibility and floating-panel behavior;
- selection hotkeys, paste behavior, Select Similar and large clipboard work;
- GenAI checkpointing and OpenArt integration;
- document lifecycle and resource boundaries;
- toolbar, project, asset and quick-export changes;
- P1 and P2 filter packs and canvas overlays;
- a new shared UI package and demo;
- buttons, colors, segments, theme, menus, toolbar, sliders, color picker and panel chrome;
- selection pixel-workflow consolidation at the end of the phase.

This was too much concurrent surface for an integration architecture whose operation boundary was not yet enforceable. It increased both product value and the number of paths by which UI state, document state and renderer state could diverge.

The heaviest churn touched exactly the integration areas that needed stronger invariants: application CSS/primitives, the editor overlay, selection controller, layer panel, grade panel, desktop host, WebGPU engine and selection rasterizer. New UI extraction was valuable, but it competed for attention with stateful editor behavior and introduced app-wide control migration risk at the same time.

## Phase 2 — 2 September to current

The later phase concentrated on the consequences:

- document/editor operation transactions;
- pixel-mutation transactions;
- committed document-surface mutation helpers;
- selection snapshot IO and undo restoration;
- layer-command rollback and failure handling;
- transform and snapping state;
- resource audits and generation guards;
- renderer publication waits and lifecycle handling.

This work was not pointless. It identified real missing contracts and added several primitives worth retaining. The problem was sequencing: the safeguards were added across the existing multi-owner architecture while broad workflows continued to depend on the old paths.

The result is more explicit safety code without a single proof that every semantic operation uses it. That explains how targeted tests can pass while marquee visibility, text transform, rasterize eligibility, warp preview or undo fails in a manual session.

## Side-by-side architectural comparison

| Concern | 26 Aug | 2 Sep | Current | Assessment |
|---|---|---|---|---|
| Canonical document state | Broad `DocumentSession` already present | Expanded state/use | More guards and transaction helpers | Direction correct in all versions |
| Mutation transaction | Snapshot grouping and one history command | Similar core plus more workflows | Several transaction layers | Still not one universal boundary |
| Renderer role | Projection plus semantic mutation | Same role, more features | More facade/boundary work | Core conflict persists |
| GPU resources | Document repository plus renderer-retained history resources | More resource paths | More audits/rollback/generation checks | Better guarded, still coupled |
| Command routing | Mounted/canonical proxy mixed properties; support mismatch | Canonical/presentation ambiguity remains | Owner selection is stricter/fail-closed | Evolution improves clarity but parity still needs proof |
| Tool lifecycle | Distributed conventions | More tools and interactions | More session/transaction helpers | No proven universal protocol yet |
| Selection | Overlay + GPU mask + clipboard/history | More pixel workflows and brush work | Extensive repair | Highest-risk state subsystem |
| Transform/warp | Multiple preview/finalization paths | More behavior and snapping | Intensive refactor | Still user-visible regressions |
| Layer finalization | Distributed eligibility/finalizers | More layer types/effects | Rollback/capability repairs | Needs one registry/service |
| Actions/MCP | Shared IDs/contracts, context-dependent dispatch | Broader command catalog | More canonical routing checks | Valuable foundation, parity unproven |
| UI system | App-local primitives | Shared UI package introduced | Broad migration | Useful, separate from core state repair |
| Test strategy | Large local suite | Slight growth | More targeted transaction tests | Volume still does not prove coherent workflows |

## Refinement of the earlier 2 September audit

The deeper 26 August review clarifies one detail. The old command registry did not simply choose the mounted port wholesale. When both ports existed, its proxy preferred mounted properties and fell back to canonical properties. `supportsCommand`, however, preferred the mounted declaration. This is more subtle and potentially more dangerous: declared capability and actual property dispatch could disagree, and one resolved port could combine two owners.

Current code moved toward choosing one owner more explicitly. That is an improvement in determinism, but it does not by itself prove that every UI, Action and MCP command is available in the correct mounted/unmounted context.

## Was 26 August architecturally better?

In some ways:

- less code and fewer recently integrated features;
- no application-wide shared-UI migration yet;
- fewer late transaction/rollback layers;
- likely fewer interactions between newly added features.

In the decisive ways, no:

- split semantic authority already existed;
- the renderer already performed mutations;
- history already crossed resource ownership;
- command routing already depended on mounted state;
- tools already lacked one mandatory lifecycle;
- merge/rasterize/flatten capability was already distributed.

It may behave better for specific workflows. Static code inspection cannot honestly claim that it does. A small manual matrix against an exact build is required.

## Did the document-state rearchitecture make sense?

Yes, as a direction. The document should own semantic edit state so that it can survive panel changes, canvas remounts, Actions, MCP, save/recovery and undo.

No, if interpreted as “move additional fields into `DocumentSession` and then coordinate the remaining owners with callbacks.” A larger document container is not a transaction architecture. The improvement becomes real only when external state is either:

- derived from the document;
- referenced through stable resource IDs governed by the same transaction; or
- explicitly ephemeral and incapable of committing semantic changes on its own.

The historical evidence shows the project pursued the right destination without first enforcing the road rules.

## What likely caused the observed degradation

No single commit or refactor explains the state. The most plausible causal chain is:

1. a broad, already complex editor had partial ownership contracts;
2. 62 commits expanded features and UI across 598 files in one week;
3. manual bugs exposed divergence among document, renderer, resource and tool state;
4. 38 commits added rollback and transactions across those same coordinators;
5. old and new paths coexisted, increasing the state graph;
6. targeted tests validated local mechanisms, not the complete user workflow matrix.

This is why reverting only the recent transaction work is unlikely to restore a reliably coherent editor.

## Rollback options

### Blind rollback to 26 August

Not recommended. It discards 100 commits, 35,783 insertions and valuable UI, filter, lifecycle and safety work while restoring the same core authority problem.

### Blind rollback to 2 September

Also not recommended. It removes current guards and rollback improvements but keeps the large late-August expansion and the original split ownership.

### Selective behavioral recovery

Recommended. Build the historical snapshots only as references. Record the expected result of a small set of workflows and port behavior—not architecture—into a newly enforced operation core.

### Full rewrite

Too risky as the first response. Reimplementing the entire renderer, tools, formats, UI and integrations would take many months and would discard specialized assets that are not the root problem.

## Repair-versus-rebuild economics

The current estimate remains that a focused integration-core repair is materially cheaper than a full rewrite, provided it is time-boxed and stops broad feature work.

A realistic bounded experiment is roughly 2–4 engineer-weeks for one senior editor/GPU engineer, or longer for a solo developer learning the system. It should not promise full product stabilization. Its purpose is to answer whether one representative vertical slice can achieve:

- deterministic begin/preview/commit/cancel;
- atomic model/resource history;
- identical UI/shortcut/Action/MCP semantics;
- correct close/reopen persistence;
- no leaked or double-released GPU resources;
- stable performance.

If this cannot be achieved without continuing to patch many unrelated owners, the integration core should be replaced more aggressively. If it succeeds, remaining tools can migrate incrementally without rewriting domain engines.

A full rewrite of a roughly 200k-line runtime with this feature breadth is more plausibly a 6–12+ month effort for an experienced team, with no guarantee that editor interaction edge cases are reproduced. It should be considered only after the bounded core experiment fails.

## Exact next step

Freeze features and define one executable vertical slice:

```text
raster open
-> marquee
-> move/copy/paste
-> transform
-> effect
-> rasterize
-> merge
-> undo/redo
-> save/close/reopen
```

Create one transaction coordinator for this slice. It must own:

1. base committed document revision;
2. preview document projection;
3. staged resource allocations/replacements;
4. commit validation;
5. one history entry containing the full transition;
6. rollback/release on every failure phase;
7. publication to every mounted presentation only after commit;
8. command invocation independent of UI, Action or MCP host.

Do not migrate every tool first. Do not add broad tests first. Prove the architecture with failure injection and a concise manual matrix, then migrate tool families one at a time.

## Decision table

| Question | Answer from the three audits |
|---|---|
| Was 26 Aug a clean golden version? | No |
| Did later work invent document-bound state? | No; it existed already |
| Was document-bound state a wrong direction? | No |
| Did late-August breadth materially raise risk? | Yes |
| Is current safety work all disposable? | No |
| Will reverting recent selection changes solve the product? | Very unlikely |
| Is the entire codebase worthless? | No; engines, adapters, algorithms and schemas are valuable |
| Is broad feature development currently defensible? | No |
| Best next investment? | Time-boxed transaction/render vertical slice |
| When to stop? | If the slice cannot enforce one owner without widespread patching |

## Final conclusion

The one-week-earlier snapshot confirms that LightTable's present instability is a product-wide integration problem, not merely the result of the latest selection work. It also shows that the application did not suddenly lose a pristine architecture: the ownership conflict was already embedded in an otherwise capable editor.

The latest code should be preserved. The historical versions should be preserved as evidence, not adopted as branches or rollback targets. The rational recovery strategy is to keep the valuable domain work, replace the mutation/render/history seam through one bounded vertical slice, and use all three snapshots to verify intended behavior before deciding whether a larger rebuild is justified.
