# Editor kernel migration

Status: **supported production mutation architecture**, introduced 2026-09-08.
The cut-over ledger records earlier exclusive-route evidence. The active
integration cleanup is [Overlay composition-root cleanup](OVERLAY_COMPOSITION_ROOT_CLEANUP_PLAN.md),
requested 2026-09-11 and executing from checkpoint `df000cc5`.
Do not infer whole-app stability or composition-only roots from cut-over status.

The kernel and its application owners form the semantic control plane for an edit. They coordinate a
document-scoped transaction from validated command through preview, commit or
cancel, history, resources and renderer invalidation. React is a UI adapter and
WebGPU is a projection/execution adapter. Neither is canonical edit authority.

Canonical revision contract (2026-09-12): `DocumentSession.documentRevision`
is a monotonic invalidation stamp, not a count of commands or history entries.
Canonical document/processing/selection publications stamp in the same snapshot;
pixel-only history transitions also invalidate it. Only one synchronous owned
publication may coalesce stamps. Command completion and Actions observation do
not advance revisions. Renderer-only previews and ordinary viewport/target chrome
do not stamp. Dirty state is history identity plus explicit non-history edits,
not inequality with the saved invalidation stamp. Never compare this clock to
`ImageDocument.revision` or claim a current-state read proves a presented frame.

## Why this exists

The current editor accumulated valid subsystems but no single enforceable owner
for a complete edit. A tool, React controller, document command and renderer can
each mutate or restore part of the same operation. Local fixes then leave pixels,
selection, layer affordances, history and GPU resources at different revisions.

The package was introduced beside the old editor, but that is not an extension
pattern. Only the supported kernel/application route may own an edit. Cleanup
is not a repository-wide rewrite and must not create a second mutation path.

## Non-negotiable boundary

```text
UI / shortcut / Action / MCP
              |
       semantic command
              v
        editor kernel
   transaction + ownership
       /             \
canonical stores   projection ports
document/history   renderer/WebGPU/UI
```

- The kernel contains no React, DOM, Electron or concrete WebGPU types.
- UI, Action and MCP routes dispatch the same semantic command.
- A migrated operation is kernel-owned from start to terminal state.
- No legacy mutation fallback may be added or revived during cleanup.
- Canonical semantic state is serializable; authored raster resources may hold
  the only current pixels and are not disposable caches. Follow the explicit
  ownership and history-retention rules in [Resource lifetime](RESOURCE_LIFETIME.md).
- Preview never becomes a history entry and never replaces its baseline.
- Commit or cancel reaches one terminal state and disposes temporary resources.

## Reading order

1. [Document ownership](DOCUMENT_OWNERSHIP.md)
2. [Edit transactions](EDIT_TRANSACTION.md)
3. [Command routing](COMMAND_ROUTING.md)
4. [Tool sessions](TOOL_SESSION_PROTOCOL.md)
5. [Resource lifetime](RESOURCE_LIFETIME.md)
6. [Render projection](RENDER_PROJECTION.md)
7. [Layer capabilities](LAYER_CAPABILITIES.md)
8. [Overlay composition-root cleanup](OVERLAY_COMPOSITION_ROOT_CLEANUP_PLAN.md),
   with [earlier cut-over evidence](KERNEL_CUTOVER_AND_CODEBASE_CLEANUP_PLAN.md)
   consulted when relevant, not treated as current acceptance.
9. The relevant vertical-slice contract, beginning with
   [Selection](SELECTION_VERTICAL_SLICE.md) and
   [Layer finalization](LAYER_FINALIZATION_VERTICAL_SLICE.md).

Superseded migration playbooks, status ledgers and interim assessments were
deleted in C14. Git history is the only archive for those transition records;
they are not valid extension guidance.

## Package-shape rule

`@lighttable/editor-kernel` is a collection of small domain contracts and pure
coordination logic, not a new god object. New responsibilities get a named
module and one owner. A module above 500 lines needs a recorded decomposition
decision before further growth; no new handwritten kernel file may exceed 800
lines. Size is a warning signal—the real split criterion is authority and
lifetime.
