# Render projection

Status: **target contract**.

The renderer consumes revisioned projections and invalidations. It may execute
paint, vector, text, filters and compositing, but it does not decide semantic
commands or mutate document/history state.

## Projection classes

- **Committed document projection:** reconstructable from canonical state and
  resource IDs.
- **Transaction preview:** disposable, keyed by transaction revision and based
  on one immutable baseline.
- **Overlay:** selection, transform handles, paths, cursors and guides; never
  serialized and never a document dirty signal.

Content and overlays use the same document-to-viewport transform. A viewport
change invalidates presentation only. Stale projections are rejected by
document and transaction revision. Clearing a transaction preview reveals the
current committed projection; it must not publish an older sampled frame.

Dirty domains are explicit. Overlay animation may not wake compositing. A
renderer optimization can be replaced or evicted without changing document
meaning, command results or history.
