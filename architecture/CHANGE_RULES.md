# Change rules

Use this checklist when adding or restructuring a feature.

## Boundaries

- Which system owns the state for each open document?
- Is canonical state serializable and free of DOM/WebGPU handles?
- Does the feature depend only on lower layers and explicit capabilities?
- Can web and Electron use the same implementation?
- Is the root component only wiring the feature, not implementing it?

## Rendering

- Which processing/compositor stage owns the operation?
- What color, alpha and coordinate domain enters and leaves it?
- What exact revisions invalidate it?
- What happens when it is disabled? Exact bypass is preferred.
- Are optional pipelines/resources lazy and explicitly disposed?
- Does device loss or document close cancel late work safely?

## Interaction and history

- Are raw events coalesced outside React state?
- Is preview separate from commit?
- Does one gesture create exactly one document-scoped undo command?
- Do cancel, undo, redo, merge, rasterize, save and reopen preserve semantics?
- Do shortcut and focus behavior work with both Ctrl and Cmd where expected?

## Performance

- Does a viewport-only change avoid compositing and analysis?
- Are unchanged/hidden/background systems asleep?
- Are readbacks and full-resolution allocations absent from hot paths?
- Is work bounded by dirty regions, revisioned caches or explicit budgets?
- Has the interaction been considered on an integrated Mac GPU?

## Compatibility and diagnostics

- Does PSD import map the feature or report it precisely?
- Are approximations labeled instead of silently substituted?
- Are worker, shader and pipeline errors phase-specific and copyable?
- Is the normal 8-bit open path unaffected by optional format support?
- Have web and desktop builds/tests both been run?

## Milestone discipline

Keep commits local and cohesive. A milestone should leave the app loadable and
the normal image path working. Update this architecture when a boundary or
contract changes; update `work/todo/` for unfinished task details. Completed
task packages move to `work/done/`, but architectural knowledge must not depend
on task archives or chat transcripts.

## Editor-kernel migration discipline

For any operation covered by `architecture/editor-kernel/`, record whether its
route is legacy or kernel before editing. Do not mix those owners inside one
gesture or command. Update `editor-kernel/MIGRATION_STATUS.md` only when the
corresponding evidence column is actually proven. A contract or test alone is
not real-app proof, and a kernel route is not complete while the legacy fallback
can still mutate part of the same operation.
