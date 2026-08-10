# Task 121 result — Smart Object Selection

Status: implementation complete; release-quality hardware/corpus gates are
carried into task 123.

## Delivered

- Photoshop-compatible W group: Object Selection and Magic Wand.
- Object Finder hover, click, rectangle and lasso-bounds prompting.
- Sample All Layers and active-subtree sampling without visibility mutation.
- Hard/soft candidate masks and normal New/Add/Subtract/Intersect selection.
- One normal selection-history entry per commit; preview creates no history.
- GPU-only transient candidate overlay, dirtying only the viewport overlay.
- Lazy worker SlimSAM backend with WebGPU attempts and WASM fallback.
- One prepared embedding per visual source, revision invalidation and stale
  result rejection.
- Serial newest-prompt handoff; queued obsolete hover prompts do not backlog.
- Explicit tensor/embedding cleanup on source replacement and disposal.
- Select Subject through distributed proposals over the cached embedding,
  ranked without pretending the model has semantic subject labels.
- Shared worker request/cache lifecycle extracted and adopted by Depth.

## Evidence

- Focused smart-selection/selection/UI contracts: green (the repository Vitest
  graph ran 989 tests, followed by 415 tests after lifecycle refinements).
- App TypeScript project: green.
- Production web build and distribution boundary: green.
- `git diff --check`: green.
- Practical 1920 x 1080 CPU-q8 probe: ~395 ms warm model load, ~1001 ms
  one-time encode, ~658 ms for 27 Select Subject candidates, best predicted
  IoU 0.98. These timings are machine/cache dependent.

## Deliberate limits / next quality gate

- The dedicated Object Selection icon is not invented; the W group temporarily
  reuses the existing Magic Wand asset until an established icon is supplied.
- SlimSAM Select Subject is a dominant-subject proposal heuristic. The backend
  is model-neutral so a measured semantic backend can replace it.
- Refine Selection is a separate workflow and was not faked here.
- Electron WebGPU/WASM cold-start, repeated-switch memory and labelled visual
  corpus measurements belong to task 123 before release qualification.
