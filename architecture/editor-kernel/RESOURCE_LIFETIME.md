# Resource lifetime

Status: **target contract**.

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
