# Command routing

Status: **supported routing contract**. Remaining prerequisite work is named below.

The stable command ID and parameters describe intent; UI location does not.
Toolbar, menu, shortcut, Action and MCP must enter the same handler and receive
the same validation result. Host permission and serialization are adapters
around that handler, not alternate document mutation implementations.

## Route

```text
origin adapter -> command envelope -> capability/parameter validation
               -> one kernel/application owner -> typed result
```

The public request carries the explicit document address and an optional
expected document revision; execution origin is passed separately in the
execution context. Internal kernel admission owns its transaction identity;
it is not a required public request field. Async mutation ownership must not
be rediscovered from a later React closure or active tab.

## One supported mutation route

The kernel cut-over is complete as a routing policy: there is no supported
legacy handler, migration switch or mutation fallback. Each operation keeps
preview, terminal publication, history and resource retirement with its named
kernel/application owners. Unavailable capabilities fail explicitly; do not
revive an old route to make a command appear successful. This policy does not
claim that every remaining owner or integration root is already cleaned up.

The public command catalog remains the external schema authority. The kernel
does not duplicate it; adapters translate catalog payloads into typed internal
commands at one boundary.

## Document command admission

Commands for one document are serialized across revision validation,
interaction settlement and handler dispatch. Commands for different documents
may still run in parallel. The optimistic `expectedDocumentRevision` is checked
before settlement: a stale request must not commit an open user interaction and
then report rejection.

The mounted document owner implements `settleInteractionBeforeCommand`. Before
a semantic document command reads canonical state, that boundary publishes any
newer selection/transform-owned state through its original owner. View zoom is
presentation-only and does not terminate a transform. The inactive canonical
owner has no presentation interaction and therefore settles as an explicit
no-op.

An owner commit produced during settlement is ordered before the command that
caused the handoff. Actions records that prerequisite commit and then the
requested command. Observations produced by the requested handler itself remain
suppressed as duplicate recordings. UI, Actions and MCP therefore share the
same admission and ordering rules.

File prerequisite implementation boundary (2026-09-12): UI file intents finish
command-producing text creation before entering the serialized runner. Queued
file commands can finish direct-owner edits, but currently reject a pending
text-creation intent explicitly. Calling public text.create execution recursively
from inside that export's settlement would deadlock behind its own queue turn.
Automatic completion for that case remains Task416 O02c.3b; do not add a second
queue, bypass validation/history or export stale state to conceal the gap.
