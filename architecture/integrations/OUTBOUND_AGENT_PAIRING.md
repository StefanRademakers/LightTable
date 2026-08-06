# Outbound Agent server pairing

Status: **implemented local TLS release slice**, 2026-08-06. A real Hetzner
deployment remains an optional credentialed smoke, never a substitute for the
local integration gate.

## Topology and transport

The desktop opens an outbound WSS connection to the authenticated MCP server;
it never exposes a public desktop port. `AgentTunnelController` owns pairing,
state, scopes, reconnect and revocation independently of editor commands. A
transport interface supports two deployment routes:

- the existing reverse-SSH trial can forward the embedded loopback bridge;
- the production route uses HTTPS one-time pairing and an outbound WSS tunnel.

Both routes terminate at the same typed automation driver and canonical command
service. Closing or replacing a transport cannot mutate or close documents.

## Trust contract

Pairing accepts a clean HTTPS origin and a six-to-64-character one-time code.
The server consumes the code, binds the session to the 96-bit device identity
and issues a 256-bit session token valid for one hour. The desktop records the
TLS certificate SHA-256 fingerprint observed during pairing and requires the
same identity for WSS. Session tokens are encrypted through Electron
`safeStorage`, can rotate over the authenticated tunnel and never enter event
history or logs.

Incoming messages include a device ID, client ID, unpredictable nonce and
timestamp. LightTable rejects cross-device routing, nonces seen in the last
bounded replay window and stale messages. A new client remains pending until
the user grants read-only or read-and-edit permission in Settings. Revocation
removes that route before acknowledging later commands. At most 64 server
requests may await one device and existing command/artifact limits still apply.

## UI and lifecycle

**Settings > Agent Access** exposes server URL, pairing code, state, pinned
server/device identity, last activity and connected clients. The states are
offline, pairing, connecting, connected, degraded and revoked. Pending clients
show explicit Allow read / Allow edit controls; approved clients can be revoked
individually, and the complete device relationship can be revoked. Recent
privacy-safe events are bounded to 100.

Unexpected disconnect uses bounded exponential reconnect (one to 30 seconds).
The user can also disconnect or reconnect manually. An expired or server-
revoked session clears protected storage and requires a new pairing code.

## Verification and deployment

`npm run smoke:desktop:agent-tunnel` starts an ephemeral self-signed local TLS
server and the packaged desktop app. It pairs once, opens outbound WSS, asks for
client edit approval, queries and edits a real PSD, rotates credentials, drops
and reconnects the socket, revokes the client, rejects further reads and
revokes the device. The local loopback listener remains off throughout.

Server configuration adds:

```text
LIGHTTABLE_DEVICE_PAIRING_CODE=<one-time operator-issued code>
LIGHTTABLE_SERVER_ID=<stable deployment identity>
```

`LIGHTTABLE_AGENT_ALLOW_LOCAL_TLS=true` exists only for the self-signed local
test harness and must never be enabled in production. Production still requires
HTTPS/WSS with a publicly trusted certificate. Pairing-code issuance, durable
multi-user tunnel state and centralized limits are completed as part of the
production MCP service milestone; the current server broker is intentionally
single-process and bounded.
