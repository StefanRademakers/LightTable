# Command routing

Status: **supported routing contract**.

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

## Captured file/text prerequisites

The document runner is one explicit queue. A validated file export may consume
one opaque tracked `text.create` handle from its captured text-creation owner.
The file owner captures creation/session/runtime before settling other edits;
font/draft preparation waits for a command handle, never recursively for public
command execution behind the parent. An already queued child is removed from its
original position and executed once by the same runner. The permitted causal
order `export -> unrelated command -> captured creation` becomes
`captured creation -> export -> unrelated command`; other documents remain free.
This is a single-level file/text contract, not a generic nested executor.

Parent schema, capability and expected-revision validation precede all
prerequisite mutation. The child retains its normal validation, settlement,
handler and original recording context. The parent's original expected revision
is not checked again against its own prerequisite's publication. Per-document
execution frames distinguish settlement observations from handler duplicates,
including while the parent is suspended for its child.

Queued creation and semantic text publication both validate their captured
lifetime, including after awaited font work and inside the mutation recipe.
Mounted text binds the concrete session/renderer lifetime, not the identity of
a replaceable UI callback object. A canceled uncommitted child cannot later
publish. An already committed child remains completed with its history intact
if presentation subsequently retires; the retired parent rejects separately.
Outside the runner, UI file intents await the same tracked creation normally.
No second queue, admission bypass or legacy mutation route is supported.
