# Embedded desktop Agent Access

Status: **implemented opt-in desktop capability**, updated 2026-08-23.

## Product contract

Agent Access controls the user's normal open LightTable desktop process. It is
off by default and can be enabled, stopped or restarted from **Preferences >
Agent Access** without reopening documents. The renderer keeps the typed automation
driver in a closure; it is never published on `window` for this production
path. Development Playwright automation remains a separate, explicit launch
mode.

The Electron main process owns the HTTP listener and credential lifecycle. It
binds only to `127.0.0.1`, uses either an explicitly validated local port or an
OS-allocated free port, and closes tracked sockets on stop and application
quit. A 256-bit token and opaque device identity are encrypted with Electron
`safeStorage` before persistence. Rotation immediately invalidates the old
token.

Automatic direct-bridge startup retries a bounded set of loopback candidates
when a candidate is occupied, reserved or forbidden by Fetch. An explicitly
requested port still fails visibly rather than silently moving. This direct
bridge allocation is separate from the normal local MCP/OAuth test origins
documented by the local Codex acceptance flow.

The ordinary local MCP path no longer exposes that token or port as the primary
UX. **Local test mode** starts the built-in loopback MCP/OAuth service and
**Connect Codex** performs registration and browser authorization. The direct
bridge controls remain under Advanced for diagnostics and isolated acceptance.
The same connected-client list grants read, one-time edit or persistent edit
for local and online modes; a persistent grant is bound to exact server and
client identity rather than a global edit switch.

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

The preferred production topology is now the product-owned outbound WSS path
described in [Outbound Agent server pairing](OUTBOUND_AGENT_PAIRING.md). The
loopback bridge remains useful for local clients and the reverse-SSH trial.
