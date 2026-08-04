# LightTable automation and command interface plan

Status: approved direction; implementation is incremental and capability-gated

Last reviewed: 2026-08-03

## Outcome

LightTable should be operable through one typed application command surface.
Menus, shortcuts, a future command palette, deterministic automated tests and
an optional MCP adapter should invoke the same application commands. DOM
selectors and synthetic keyboard events remain useful for a small UI smoke
layer, but they are not the public automation API.

The command surface must not become a second editor architecture. Canonical
documents, document-scoped history, task cancellation, renderer ownership and
host I/O remain authoritative.

## Existing foundations

- `DocumentCommandHistory` already owns reversible, document-scoped mutations,
  dirty checkpoints, resource retention and bounded undo/redo.
- `DocumentTaskRegistry` already owns cancellable asynchronous operations and
  rejects stale results.
- keyboard resolution is declarative and execution is separated through typed
  ports;
- menu state is a read-only capability projection and menu commands bind to
  application controllers;
- file open/save is behind `LightTableHost` and the document file controller;
- tool sessions already keep pointer streams out of React state and commit one
  history operation per gesture.

The first implementation work should connect these owners, not replace them.

## Contract model

Use three deliberately different contracts.

### 1. Commands

A command is a bounded intent such as `layer.createRaster`, `layer.rename`,
`text.setCharacterStyle`, `view.setZoom`, `file.saveNative` or
`export.pdf.preflight`.

Each command descriptor contains:

- a stable namespaced ID and schema version;
- validated serializable parameters;
- scope: application, workspace or explicit document ID;
- capability/precondition projection;
- whether it mutates canonical state, presentation state or external I/O;
- whether it is synchronous or returns a task handle;
- a typed success result and stable error code;
- menu/shortcut/command-palette metadata where appropriate.

Commands call existing controllers. They do not mutate React state, WebGPU
stores or document objects directly.

### 2. Queries and subscriptions

Queries read bounded projections, never internal class instances:

- workspace documents and active document ID;
- canonical layer tree summaries and stable layer IDs;
- active tool, selection summary and editable properties;
- command availability plus the reason a command is unavailable;
- task progress, history/dirty state and compatibility diagnostics;
- renderer telemetry through the existing bounded diagnostics model.

Subscriptions publish revisioned snapshots or semantic events. Consumers must
be able to detect a missed revision and request a fresh snapshot. Do not stream
React renders, raw pointer moves or unbounded debug logs.

### 3. Gestures

Painting, transforms, selections, pen paths and text-range dragging are
transactions rather than ordinary JSON commands. A gesture API should expose
`begin`, bounded samples/updates, `commit` and `cancel`, backed by the existing
tool-session controllers. One committed gesture produces one history entry.

Coordinates always declare their space (`viewport`, `document`, `layer-local`)
and use the scene-transform authority. Automated tests should prefer semantic
document coordinates. Raw event injection remains a UI-routing test only.

## Suggested TypeScript boundary

```ts
interface LightTableCommandRequest<T = unknown> {
  protocolVersion: 1;
  requestId: string;
  command: string;
  documentId?: string;
  parameters: T;
  expectedDocumentRevision?: number;
}

type LightTableCommandResult<T = unknown> =
  | { requestId: string; status: 'completed'; value: T; revisions: RevisionSet }
  | { requestId: string; status: 'accepted'; taskId: string }
  | { requestId: string; status: 'rejected'; code: string; message: string };
```

The concrete registry should use discriminated TypeScript maps and runtime
validators; it must not accept arbitrary method names or evaluate code.

## File and pixel payloads

Large binary data never travels inline in command JSON.

- Desktop uses host-issued file/artifact handles and bounded IPC transfers.
- Web uses `File`, `Blob`, File System Access handles where available, or
  upload/download artifact IDs owned by the host adapter.
- MCP receives metadata and opaque artifact handles; it does not receive a
  multi-gigabyte PSD or GPU readback inside a tool result.
- Pixel inspection uses explicit bounded thumbnails, sampled regions or an
  export artifact. GPU textures and object URLs never cross the public API.

## Playwright strategy

Keep two layers:

1. A small physical UI suite checks menus, shortcuts, pointer routing, focus,
   accessibility names, modal stacking and screenshots.
2. A larger deterministic product suite uses the command/query bridge to set
   up documents and assert canonical outcomes without brittle DOM traversal.

The current desktop screenshot runner already proves physical open, PDF/PSD
paint overlays, high zoom, compatibility report access, native save and fresh-
process reopen. Move reusable orchestration into a dedicated driver only after
the command registry exists; do not expose the current CSS selectors as API.

Test commands should be available only in development/test builds. Production
commands use the same registry but are reached through normal UI or an
explicitly enabled external adapter.

## MCP direction

MCP is an adapter over the command/query service, not an editor-specific set of
backdoors. Initial tools should be coarse and safe:

- list/open/activate documents;
- inspect layers and command capabilities;
- create/select/rename/reorder layers;
- apply typed property patches;
- run bounded exports and retrieve artifact metadata;
- observe task completion and compatibility reports.

Desktop external control must be opt-in, localhost/named-pipe only, bound to a
short-lived capability token and visibly indicated in the existing status or
activity UI. Destructive/external-I/O commands retain host confirmation policy.
Web embedding uses an explicit host bridge with origin and capability checks;
there is no globally writable `window.lighttable` in production.

## UI/UX exposure

Each registered user-facing command can supply one shared label, availability
reason and optional shortcut. Menus and a future command palette consume that
metadata, preventing shortcut/menu/MCP drift.

Automation itself needs no permanent panel. If external control is later
enabled, use existing Settings/status/dialog patterns for:

- enable/disable and session token lifecycle;
- connected-client identity;
- bounded recent command/activity log;
- revoke/disconnect;
- confirmation for commands that write outside the current document.

## Execution phases

### Phase A - inventory and read-only contract

- catalogue existing menu, keyboard, layer, text, vector, selection, viewport,
  file and export commands;
- define stable command/error/revision types and runtime validation;
- expose bounded workspace/document/layer/capability queries;
- test that disabled commands report the same reason to every consumer.

### Phase B - shared command registry

- route a small vertical slice (`view.setZoom`, `layer.createRaster`,
  `layer.rename`, undo/redo) through the registry;
- bind keyboard and menu controllers to it without UI changes;
- retain exact history and dirty-state behavior;
- add command tracing to existing bounded diagnostics.

Implemented baseline: the standalone workspace owns one command service and
document-port registry. Mounted editor runtimes register their existing zoom,
layer and history controllers; toolbar, menu, Layers panel and keyboard entry
points invoke that same registry. Transport adapters therefore cannot mutate a
document whose runtime is absent, and unmount removes its ports deterministically.
Structured subscription tracing remains part of the later adapter work; rejected
UI commands already surface through the editor's bounded error presentation.

### Phase C - async I/O and artifacts

- expose open, native save and export through host-issued artifact handles;
- return task IDs and use `DocumentTaskRegistry` cancellation/stale guards;
- add PDF/PSD compatibility-report queries;
- verify web and Electron use identical command semantics.

### Phase D - transactional gestures

- add brush, transform and selection gesture sessions in document coordinates;
- enforce sample/count/byte limits and one-history-entry commit;
- add deterministic paint/transform Playwright setup without bypassing the
  renderer or canonical tools.

### Phase E - test driver

- build a thin Playwright driver over commands, queries and subscriptions;
- retain representative selector/event screenshots for actual UI behavior;
- cover save/reopen in a fresh process and crash/timeout cleanup;
- publish machine-readable test artifacts and screenshots under `tmp/` only.

### Phase F - optional MCP adapter

- map a deliberately small tool set onto the stable registry;
- add opt-in transport, authentication, limits, activity visibility and
  revocation;
- keep unsupported/high-risk operations absent rather than silently no-op;
- version protocol additions without tying them to PSD/PDF internals.

## Always-green gates

Every phase must preserve web and Electron builds, ordinary UI operation and
document save/reopen. Registry tests cover validation, preconditions, document
targeting, stale revisions, task cancellation, history atomicity and stable
error codes. Physical tests cover only behavior that typed tests cannot prove:
focus, event routing, native host dialogs, pixels and visual layout.
