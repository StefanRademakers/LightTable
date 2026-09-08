# Migration playbook

Status: **active migration rule**.

## Slice selection

Choose one short artist-visible workflow, not one internal function. Record its
initial document, exact gestures/commands, expected pixels, selection, layers,
affordances, history and resource outcome.

The first candidate is:

```text
open PNG -> rectangle marquee -> move/nudge across document edges
-> paint -> copy/paste -> undo/redo -> save/close/reopen
```

## Work sequence

1. Trace the current route and name every authority mutation.
2. Add missing kernel contract only when the slice proves it is necessary.
3. Build adapters at legacy package boundaries; do not move algorithms.
4. Route the entire semantic command to the kernel behind one switch.
5. Use focused tests while editing; run boundary/typecheck at the slice gate.
6. Exercise the exact real WebGPU workflow and record manual evidence.
7. Remove legacy route/imports, then mark the slice kernel-owned.

## Mega-file reduction

Split by owner while a migrated slice removes responsibility:

- `LightTableEditorOverlay.tsx`: retain composition; extract input routing,
  session ownership, projection subscriptions and publication adapters.
- `useLayerDocumentCommands.ts`: become a thin command gateway; move semantic
  orchestration into the kernel and algorithms into their domain packages.
- `LayerDocumentRenderer.ts`: retain facade/projection duties; remove semantic
  mutation, history and source-publication decisions.
- `WebGpuEngine.ts`: later split resource registry, scheduling, compositor and
  overlay execution only after their ports are exercised by a slice.

No mechanical “500-line refactor” is accepted. A split is complete only when
the extracted owner has a narrow API, explicit lifetime and no backdoor to the
old authority.

## Gate

A slice is complete only when route equivalence, history, stale-result rejection,
resource cleanup and real-app behavior pass. Code inspection and unit tests are
necessary evidence, not the user-visible acceptance result.
