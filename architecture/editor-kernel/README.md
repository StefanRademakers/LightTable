# Editor kernel migration

Status: **active production cut-over**, introduced 2026-09-08 and entering
fallback removal on 2026-09-10. The cut-over ledger is the authority for whether
an existing editor workflow is exclusively kernel-owned.

The kernel is the future semantic control plane for an edit. It coordinates a
document-scoped transaction from validated command through preview, commit or
cancel, history, resources and renderer invalidation. React is a UI adapter and
WebGPU is a projection/execution adapter. Neither is canonical edit authority.

## Why this exists

The current editor accumulated valid subsystems but no single enforceable owner
for a complete edit. A tool, React controller, document command and renderer can
each mutate or restore part of the same operation. Local fixes then leave pixels,
selection, layer affordances, history and GPU resources at different revisions.

This package is built beside the legacy editor. It is not a repository-wide
rewrite and it must not become a second partial mutation path.

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
- A legacy operation stays entirely legacy until its vertical slice passes.
- Canonical state is serializable; GPU handles are disposable projections.
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
8. [Cut-over and codebase cleanup](KERNEL_CUTOVER_AND_CODEBASE_CLEANUP_PLAN.md)
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
