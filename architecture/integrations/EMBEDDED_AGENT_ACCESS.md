# Embedded desktop Agent Access

Status: **implemented opt-in desktop capability**, 2026-08-06.

## Product contract

Agent Access controls the user's normal open LightTable desktop process. It is
off by default and can be enabled, stopped or restarted from **Settings > Agent
Access** without reopening documents. The renderer keeps the typed automation
driver in a closure; it is never published on `window` for this production
path. Development Playwright automation remains a separate, explicit launch
mode.

The Electron main process owns the HTTP listener and credential lifecycle. It
binds only to `127.0.0.1`, uses either an explicitly validated local port or an
OS-allocated free port, and closes tracked sockets on stop and application
quit. A 256-bit token and opaque device identity are encrypted with Electron
`safeStorage` before persistence. Rotation immediately invalidates the old
token.

## Security boundary

Unauthenticated callers may read only `/health`, `/version` and a document-free
`/status`. All document queries, commands, gestures and artifacts require a
timing-safe bearer-token check. The bridge rejects foreign browser origins,
unknown methods, invalid identifiers, invoke bodies over 1 MiB and artifacts
over 32 MiB. The application command service still applies its own command,
batch, revision and artifact limits.

The preload exposes narrow lifecycle IPC and one request/response channel. The
main process cannot inspect React state or GPU resources, and the renderer
cannot open a socket. Requests cross into the same `LightTableCommandService`
used by the UI, so normal history, task progress, validation and undo remain
authoritative.

## Verification

`npm run smoke:desktop:agent-access` launches one packaged Electron instance,
opens a real PSD, enables Agent Access, queries and renames an existing layer,
rejects an invalid token, creates and switches to a second document, rotates
credentials, stops/restarts without document loss and proves each stopped
listener is closed. Unit tests cover loopback allocation, port conflicts,
origin/method/body rejection, credential protection and deterministic socket
shutdown.

The separate remote MCP server remains an optional adapter. It connects to
this local bridge through a user-controlled private/reverse tunnel; it does not
change the local trust boundary or create a second editor model.
