# Resource lifetime

Status: **implemented kernel contract** (C13, 2026-09-11).

Every expensive or non-serializable resource has one explicit owner:
transaction, document or history. Ownership transfer is recorded; shared reachability
or a JavaScript reference is not ownership.

## Lifetime

```text
transaction temporary --commit--> document/history retained
        |                              |
      cancel                         eviction/close
        v                              v
      release                        release
```

- Preview resources belong to the transaction and are replaceable.
- Committed layer resources belong to the addressed document session.
- Resources required for undo belong to that document's history until eviction.
- Renderer caches may refer to resource IDs but remain reconstructable.
- Device loss invalidates GPU realizations, not canonical resource identity.
- Release is idempotent and owner-checked; stale cleanup cannot free a new owner.

Byte estimates are required for bounded history and memory pressure. A command
cannot claim success while leaving ownership ambiguous. Readback is not a
lifetime strategy and is forbidden from pointer-hot paths without evidence.

## Current implementation

- Every open workspace document receives a unique session resource key. A
  persisted image-document ID is not a GPU owner and cannot make two opens of
  the same source share mutable resources.
- `DocumentGpuResourceRegistry` owns the session-to-device lease. Close detaches
  the exact layer, pattern and color-lookup repositories synchronously; physical
  destruction waits for that device queue's submitted work.
- A detached generation cannot destroy a later generation registered under the
  same key. Cleanup closures capture the detached resource sets, never a live
  renderer reference.
- Device-loss subscriptions are bound to the exact `GPUDevice`. Loss retires
  only that device generation; reconstructable documents may rebuild while
  non-reconstructable raster documents fail closed as checkpoint-required.
- Terminal renderer errors destroy and unsubscribe the failed generation before
  publishing its guarded failure callback. Stale asynchronous lookup loads and
  callbacks cannot publish after close, replacement or generation change.
- History pruning addresses the private session resource key and therefore
  cannot prune a sibling open of the same persisted document.

This contract does not make `WebGpuEngine` a suitably small facade. Its remaining
projection, diagnostics, readback and allocation authorities are C14 cleanup
work; the resource-lifetime cut-over must not be used to justify further growth.
