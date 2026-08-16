# LightTable MCP v1 integration

Status: **implemented semantic integration**, updated 2026-08-14.

## Decision

MCP is a network adapter over the existing semantic LightTable command
service. It is not a second editor API, document model, undo stack or renderer.
Every edit enters the same typed commands and bounded gestures used by desktop
automation. Stable document/layer IDs, explicit document revisions and normal
history remain authoritative.

The remote endpoint uses MCP Streamable HTTP. Authentication uses an OAuth
authorization-code flow with PKCE S256, dynamic client registration, protected
resource metadata, rotating refresh tokens and separate `lighttable:read` and
`lighttable:edit` scopes. A server-owner pairing code gates authorization and
invalid attempts are bounded. Production endpoints require HTTPS.

This follows the current MCP authorization requirements for OAuth discovery
and protected-resource metadata:
<https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>.
ChatGPT connects to a remote MCP endpoint rather than directly to localhost;
the current setup and plan limitations are documented by OpenAI at
<https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta>.

## Runtime topology

```text
ChatGPT / MCP client
        |
        | HTTPS + OAuth, Streamable HTTP
        v
Hetzner: apps/mcp-server
        |
        | approved client route over outbound WSS
        v
Desktop: embedded, opt-in Agent Access bridge
        |
        v
LightTable command service -> history/document model -> GPU renderer
```

The local bridge is owned by the normal LightTable Electron main process. It binds
only to `127.0.0.1`, is disabled by default and requires an OS-protected,
rotatable high-entropy device token. Enable it in **Settings > Agent Access**;
the displayed address and token configure the private tunnel. Stopping it
closes listeners without closing documents. See
[Embedded desktop Agent Access](EMBEDDED_AGENT_ACCESS.md).

For the Hetzner trial, create an outbound reverse SSH tunnel from the desktop:

```powershell
ssh -N -R 127.0.0.1:8790:127.0.0.1:8790 lighttable@SERVER
```

The MCP process on the server then uses
`LIGHTTABLE_BRIDGE_URL=http://127.0.0.1:8790`. Do not bind the desktop bridge to
a public interface. OpenAI's Secure MCP Tunnel is another suitable private
transport when it is available for the target workspace.

The production-oriented route no longer needs SSH: Settings pairs once over
HTTPS, pins the server identity and opens WSS outbound from the desktop. Client
read/edit scopes require explicit desktop approval. See
[Outbound Agent server pairing](OUTBOUND_AGENT_PAIRING.md).

## V1 tool surface

Read operations:

- inspect workspace, document dimensions/aspect/revision/viewport;
- list the compact editable layer tree;
- inspect Layer Style effects;
- query currently valid semantic commands;
- request a PNG preview through LightTable's real export renderer.

Write operations:

- create documents through the dedicated creation tool;
- create/place/rename/show/hide raster layers and set fill opacity;
- query, create and edit point/paragraph text and layout/style runs;
- query, create, update and remove editable vector elements, shapes, fills,
  strokes and gradients;
- query, add, update, remove, move and enable/bypass Layer Style effects;
- set zoom and undo/redo;
- execute bounded brush, selection and layer-translate gestures;
- execute up to 64 supported semantic edits as one atomic publication and one
  named undo entry, including references to earlier operation results;
- observe reconnect-safe async task events and cancel supported tasks;
- import a generated public HTTPS PNG/JPEG/WebP/AVIF, maximum 32 MiB;
- export native LightTable, PNG and PSD artifacts.

Image imports reject credentials, custom ports, loopback, private and
link-local destinations and revalidate redirects. Artifacts are opaque,
in-process and bounded to 32 entries / 512 MiB; binary content crosses only
the explicitly enabled host bridge.

The server also contains a complete editable social-design workflow that uses
the same public commands to create a document, placed artwork, gradient vector,
point/paragraph text and a drop shadow, then verifies undo/redo and exports GPU
preview, native and PSD artifacts. Remaining gaps include broad semantic
coverage for transforms, masks, selections, adjustments and many interactive
tools. Those must be added to the shared application command service first;
DOM selectors or a parallel MCP-only scene format remain forbidden.

### Exposure-list ownership

The current runtime has related but non-identical capability projections:

- `LightTableCommandId` is the complete application command union;
- `AuthenticatedLightTableMcpAdapter` has a tested transport-neutral allowlist,
  but the production Agent Access bridge does not currently instantiate it;
- `apps/mcp-server` has a generic command enum plus bespoke document, text,
  vector, style, import, preview and design tools.

The Electron main bridge authenticates and bounds requests, then invokes the
renderer-owned automation driver through narrow IPC. This is still one command,
document, history and renderer authority, but the exposure metadata can drift.
Currently the adapter includes resize and Face Warp but omits PSD export, while
the MCP generic list includes PSD export but omits resize/Face Warp; document
creation is a bespoke MCP tool. Consolidate or generate these projections
before treating the surface as a stable third-party plugin ABI.

## Hetzner deployment example

Install Node.js 20 or newer, copy the repository or a production package, run
`npm ci`, and configure `/etc/lighttable-mcp.env`:

```text
NODE_ENV=production
PORT=8787
HOST=127.0.0.1
LIGHTTABLE_PUBLIC_URL=https://mcp.example.com
LIGHTTABLE_ALLOWED_HOSTS=mcp.example.com
LIGHTTABLE_PAIRING_CODE=<rotate-for-the-test-user>
LIGHTTABLE_BRIDGE_URL=http://127.0.0.1:8790
LIGHTTABLE_BRIDGE_TOKEN=<independent-random-32-byte-token>
```

Example systemd unit:

```ini
[Unit]
Description=LightTable MCP
After=network.target

[Service]
Type=simple
User=lighttable
WorkingDirectory=/opt/lighttable
EnvironmentFile=/etc/lighttable-mcp.env
ExecStart=/usr/bin/npm run mcp:server
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Terminate TLS in Caddy or nginx and proxy only `/mcp`, `/oauth/*` and the
well-known metadata routes to `127.0.0.1:8787`. Keep `/health` available to the
local health checker. Do not enable `LIGHTTABLE_ALLOW_INSECURE_HTTP` in this
deployment.

The included OAuth store is intentionally single-process and in-memory:
restarting revokes sessions, which is useful for the first private trial. A
multi-user public service must replace it with a durable authorization service,
CSRF/session protection, centralized rate limiting, audit retention and tenant
isolation before release.

## Verification evidence

`npm run smoke:desktop:agent-access` verifies the product-owned bridge in one
packaged desktop instance. `npm run smoke:mcp` remains the full remote protocol
test and currently uses the isolated development bridge fixture. Its 2026-08-06
run used `D:\shapes.psd`, added and renamed an editable raster layer, painted a
single undoable stroke, fetched a GPU preview and exported all three artifacts.
Evidence is under `D:\mediavibe\LightTableTestFiles\mcp`:

- `mcp-layered-design.png`;
- `mcp-layered-design.lighttable`;
- `mcp-layered-design.psd`;
- `mcp-layered-design.json` (IDs, revisions, layer count and artifact metadata).

The canonical revision advanced from 0 to 3 for the create, rename and gesture
commit. The bridge shut down with zero remaining Electron processes.

Unit/integration coverage includes PKCE, one-use authorization codes, refresh
rotation/replay rejection, redirect validation, SSRF guards, read/edit scope
separation, protected-resource discovery, Streamable HTTP tool discovery and
typed tool execution.

## Next semantic expansion

The original document/asset/text/vector/style/batch/task slices are now
implemented. Expand only through the shared command service, prioritizing:

1. layer transforms, reparenting and alignment with explicit coordinate space;
2. selections, masks and their editable properties;
3. Grade/Lens Fx and adjustment-layer semantics;
4. remaining tool operations that can be expressed deterministically;
5. richer structural and visual inspection for reference-image reconstruction;
6. version negotiation, ID-lifetime and permission contracts suitable for a
   future plugin ABI.
