# LightTable architecture comparison — 2026-09-02 versus 2026-09-06

Comparison prepared: 2026-09-08  
Historical baseline: `0298946f31cf9b19b6d490e8aa63fb61db96c566`  
Current committed baseline audited on 2026-09-06: `cce15c7c557a756fc3aabf2777d6bd5a8e8b643b`

## Bottom line

The post-2-September work did not turn a clean architecture into a broken one. The critical architectural ambiguity already existed: a document session held canonical state, while renderer/GPU resources, history objects, tool sessions and mounted command ports also participated in semantic mutations.

The later work attempted to make that ambiguity safer by adding document transactions, rollback, generation guards, canonical publication waits and resource audits. Those are directionally correct mechanisms. The problem is that they were layered across the existing integration model rather than first replacing it with one enforced transaction authority. This increased code and state-transition complexity in the most sensitive files while user-visible regressions showed that the end-to-end invariants were still not closed.

Therefore:

- **2 September is a useful behavioral oracle, not a clean architecture to restore blindly.**
- **Current main contains safety work worth keeping, but it is not proof of a stable architecture.**
- **A raw revert would trade known current regressions for older structural risks and discard useful primitives.**
- **The best decision remains a bounded integration-core replacement, informed by comparative manual behavior.**

## Quantitative delta

### Repository scale

| Area | 2 Sep snapshot | Current audited baseline | Delta |
|---|---:|---:|---:|
| Runtime/source files | 1,127 | 1,143 | +16 |
| Runtime physical lines | 210,345 | 216,067 | +5,722 |
| Runtime nonblank lines | 198,428 | 203,943 | +5,515 |
| Test files | 658 | 665 | +7 |
| Test physical lines | 73,811 | 76,104 | +2,293 |
| Script files | 226 | 227 | +1 |
| Total code-like files | 2,035 | 2,059 | +24 |
| Total physical lines | 324,438 | 332,511 | +8,073 |

Git reports 38 commits and 300 changed files between the baselines, with 13,394 insertions and 4,226 deletions. Within the application/editor/GPU area, 218 files changed with 10,276 insertions and 3,163 deletions.

### Concentration of change

The largest churn occurred in exactly the cross-boundary coordinators implicated by both audits:

- `LightTableEditorOverlay.tsx`: +874 / -511;
- `useLayerDocumentCommands.ts`: +1,001 / -350;
- transform controller: +602 / -230;
- selection session controller: +447 / -255;
- `WebGpuEngine.ts`: +436 / -159;
- image resize GPU service: +268 / -136;
- document mutation controller: +325 / -36;
- layer style editor: +237 / -18;
- viewport controller: +209 / -11.

New transaction-oriented helpers and documents were also introduced, including editor-operation transactions, pixel-mutation transactions, committed document-surface mutations and transaction-model documentation.

The amount of change is not automatically excessive for the problem. The concern is that broad edits landed across several authorities before one end-to-end contract was proven.

## What was already true on 2 September

| Concern | 2 Sep evidence | Conclusion |
|---|---|---|
| Document-bound state | `documentSession.ts` held document/editor/viewport/processing/history/tasks/revisions | Moving state to documents was already underway |
| Canonical vs presentation commands | `documentSessionCommandPorts.ts` classified presentation-required commands | Command behavior already depended on renderer mounting |
| Mounted port routing | command registry preferred the mounted document port | UI and headless execution already had different readiness constraints |
| Renderer semantic ownership | `LayerDocumentRenderer` handled selection, clipboard, mask and resource operations | Renderer was already more than a pure projection |
| GPU-backed history | history retained resources and detached runtimes | Undo already depended on resource lifetime |
| Tool lifecycle diversity | selection, transform, paint, vector, text and warp had different controllers | No mandatory shared begin/preview/commit/cancel protocol |
| Large orchestrators | overlay, engine, layer panel and command services were already large | Local changes already required broad mental context |
| Broad processing models | Grade/Lens FX, filters and Layer Styles coexisted | Finalization and history already crossed multiple processing systems |

This is the key historical finding: the later re-architecture was responding to a real pre-existing problem.

## What the later work added

The 38 commits show a coherent intent:

- make fill and history atomic;
- make selection state and snapshots document-owned;
- route transform and geometry through document transactions;
- make renderer pixel mutations atomic;
- transactionally create and prune resources;
- wait for canonical presentation;
- bind GPU recovery to document generations;
- move warp, vector, text, paint, styles and adjustment previews into explicit transaction lifecycles;
- centralize document preview transactions;
- roll back rejected history and text/grade mutations;
- fail closed on command routing;
- make batches, LUT imports and geometry atomic;
- serialize history restoration and async publication;
- guard asynchronous GPU work by generation;
- share optional pipelines;
- audit filter resource cleanup;
- place selection snapshot I/O behind the rasterizer boundary.

These are not random changes. They target the correct failure classes identified by the current audit.

## Why the result still regressed

### 1. Transaction helpers did not replace all authorities

New wrappers can make individual paths safer while old direct paths remain. If one workflow updates canonical state through a transaction but another renderer or UI path still owns mutable truth, the system gains another lifecycle to coordinate rather than losing one.

### 2. Several tool families were migrated concurrently

Selection, transform, paint, vector, text, warp, adjustments, styles and layer mutations were all touched in a short commit range. Their state machines interact through active layers, selections, renderer resources and history. Without a locked vertical proof after each family, regressions could compound.

### 3. Static and local tests did not prove observable atomicity

The added tests increased coverage, but the reported failures were end-to-end state disagreements: visible selection versus copy mask, layer type versus rasterize capability, transform preview versus committed pixels, undo stack versus GPU restoration. Those require invariant tests across the real runtime.

### 4. The architecture documents became more precise than the runtime

The new transaction documents improved understanding, but documentation cannot stop a caller from bypassing the intended path. Contracts need APIs that make invalid transitions unrepresentable or immediately fail.

### 5. Change was concentrated in god coordinators

Large diffs in the overlay, layer commands and WebGPU engine made it difficult to establish that every entry and exit path respected the new model. This is where high reasoning effort and many tests still cannot substitute for reduced state authority.

## Side-by-side architecture assessment

| Area | 2 September | Current audited baseline | Direction |
|---|---|---|---|
| Document ownership | broad snapshot, incomplete atomicity | more state/transactions tied to document | improved intent |
| Transaction model | mostly conventions and command callbacks | explicit helpers across many workflows | structurally improved, incompletely enforced |
| Async generation safety | partial | explicit GPU/document generation guards | improved |
| Failure rollback | caller-specific | more rejected-operation rollback | improved locally |
| Renderer purity | renderer owns semantic operations/resources | still not a pure committed-revision projection | unresolved |
| Command routing | canonical/presentation split | more explicit fail-closed routing | improved diagnostics, split remains |
| Tool lifecycle | family-specific | more transaction wrappers, still family-specific | partially improved |
| Layer capability model | distributed checks | user regressions show distributed checks remain | unresolved/regressed behavior |
| History/resource relation | retained GPU resources, callback rollback | more restoration guards and snapshots | improved machinery, invariant unproven |
| Complexity | smaller but implicit | larger and more explicit | knowledge improved; runtime burden increased |
| User-facing stability | not proven by this audit | reported unusable in several basic flows | current behavior worse by observed evidence |

## Did coupling state to the document make the architecture better?

Yes, as a direction. No, as a completed solution.

It is better for selection, transform sessions, history and asynchronous tasks to be scoped by document rather than by global UI components. It prevents cross-document leakage and makes persistence and automation conceptually possible.

It becomes worse if “document-owned” means only that the document session coordinates references to several mutable systems. The document must own the committed revision and resource-set identity. Tools may own transient previews; renderers may own caches. Neither may independently redefine committed semantic state.

The correct lesson is not to undo document scoping. It is to finish the ownership model by removing duplicate semantic authorities.

## Revert, repair or rebuild

### Revert wholesale to 2 September

Advantages:

- possibly restores user-visible behavior in workflows that regressed;
- removes approximately 5,700 runtime lines and 38 commits of integration churn;
- gives a smaller immediate debugging surface.

Disadvantages:

- restores the same renderer/document/history ownership ambiguity;
- discards useful rollback, transaction and generation primitives;
- does not solve mounted versus canonical command routing;
- requires redoing the architecture work under time pressure;
- may restore bugs that motivated the rework.

Verdict: not justified without a comparative smoke matrix showing a dramatic and broad behavioral advantage.

### Continue patching current paths

Advantages: preserves all recent work.  
Disadvantages: remains open-ended, high regression risk and economically unbounded.  
Verdict: reject.

### Bounded strangler replacement of the integration core

Advantages:

- preserves specialized engines and useful later safety primitives;
- establishes one new document/resource/transaction authority;
- permits old and new vertical workflows to be compared;
- has measurable pass/fail gates.

Verdict: preferred, but only as a time-boxed proof rather than another broad refactor.

### Full rewrite

Advantages: clean conceptual start.  
Disadvantages: 6–12+ months solo to regain breadth, high reintegration risk, likely loss of hard-won domain behavior.  
Verdict: only if the bounded vertical-slice proof fails.

## Cost comparison

These are planning estimates based on repository scale and coupling, not promises.

| Path | Estimated effort | Risk |
|---|---|---|
| Patch current runtime broadly | at least 3–6 months solo, no credible upper bound | very high |
| Repair from 2 Sep snapshot | 10–16 engineer-weeks plus feature tail | high |
| Replace current integration core incrementally | 8–14 engineer-weeks for credible core and representative migration; likely 2–4 solo calendar months | high but measurable |
| Full product rewrite | 6–12+ solo months before comparable breadth | extremely high |

The historical snapshot is not cheaper enough architecturally to outweigh the useful safety work it lacks. Its main value is behavioral comparison.

## Decision experiment before committing more budget

Time-box one vertical slice to 5–10 working days:

```text
open one raster image
-> create and move a selection
-> copy/paste as a pixel layer
-> transform repeatedly without resampling loss
-> add and preview one adjustment/effect
-> rasterize
-> merge down
-> undo and redo every committed step
-> save, close and reopen
-> execute representative steps via Action and MCP
```

Hard requirements:

- one committed document revision at each step;
- one owned resource set per revision;
- renderer consumes revisions and cannot mutate canonical state;
- exactly one history entry per user commit;
- cancel/failure produces no visible or retained change;
- no stale publication after document switch;
- no leaked GPU resources after repeated run;
- same declared result through UI, Action and MCP.

Run the same workflow on the 2 September build, current build and proof runtime. This turns the old snapshot into evidence rather than nostalgia.

Stop the rescue attempt if the proof cannot satisfy the invariants within the time box without bypasses or special cases. At that point a rebuild or cancellation decision has evidence behind it.

## Final comparison

The 2 September snapshot confirms that LightTable's current instability was not created solely by the latest transaction rework. The underlying split of semantic authority was already embedded in the product. The later work correctly identified many failure modes and added useful mechanisms, but it changed too many interacting paths before one complete workflow proved the architecture.

The current state is therefore not “good old version versus bad new version.” It is:

- an older version with less explicit safety, possibly better behavior in some flows, and the same architectural fault line;
- a newer version with better safety vocabulary and partial mechanisms, but more integration complexity and observed regressions;
- a valuable body of specialized engine code that should not be discarded without a bounded rescue proof.

The economically rational next step is not another feature fix, another broad audit or a blind revert. It is the single vertical decision experiment above, with 2 September used as a behavioral oracle and with a hard stop criterion.
