# Edit transaction

Status: **normative transaction contract**. The kernel implements shared
selection and applied-pixel coordinators as well as lifecycle/port types;
application owners compose domain operations around them. This is not a claim
that one generic coordinator implements every tool or that Task416 is complete.

## Lifecycle

```text
open -> previewing -> committing -> committed
  |          |             |
  +----------+-> cancelling -> cancelled
  |          |
  +----------+----------------> failed
```

One transaction captures an immutable document address, semantic baseline,
options and resource ownership. Preview revisions increase monotonically and
replace only the disposable preview. A second gesture is a second transaction.

## Commit order

Each admitted operation must prepare its effects before publication:

1. validate document/session/revision and capability;
2. prepare canonical patch, inverse/history payload and resource transfers;
3. execute required bounded renderer/GPU work without publishing canonical state;
4. atomically publish the canonical change and history state;
5. transfer retained resources to document/history ownership;
6. invalidate the smallest render domains;
7. release the baseline and temporary preview resources.

If any prepare step fails, canonical state and history remain unchanged. If an
adapter can fail after canonical publication, it must offer a proven compensating
rollback; otherwise that adapter is not admissible to the kernel transaction.

## Invariants

- Exactly one terminal outcome: committed, cancelled or failed.
- One completed user gesture creates zero or one history entry, never several.
- Cancel restores the baseline semantically; it does not sample the current frame.
- Undo/redo are transactions with the same document and resource safeguards.
- Save observes committed state only.
- No handler catches a failure and silently reports success.
