# LightTable MCP v1 integration

Status: **implemented vertical slice**, 2026-08-06.

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
        | bearer-authenticated private/reverse tunnel
        v
Desktop: loopback automation bridge
        |
        v
LightTable command service -> history/document model -> GPU renderer
```

The bridge binds only to `127.0.0.1` and requires a high-entropy shared token.
For the Hetzner trial, create an outbound reverse SSH tunnel from the desktop:

```powershell
ssh -N -R 127.0.0.1:8790:127.0.0.1:8790 lighttable@SERVER
```

The MCP process on the server then uses
`LIGHTTABLE_BRIDGE_URL=http://127.0.0.1:8790`. Do not bind the desktop bridge to
a public interface. OpenAI's Secure MCP Tunnel is another suitable private
transport when it is available for the target workspace.

## V1 tool surface

Read operations:

- inspect workspace, document dimensions/aspect/revision/viewport;
- list the compact editable layer tree;
- inspect Layer Style effects;
- query currently valid semantic commands;
- request a PNG preview through LightTable's real export renderer.

Write operations:

- create/rename/show/hide raster layers and set fill opacity;
- enable/bypass layer styles and individual effects;
- set zoom;
- undo/redo;
- execute bounded brush, selection and layer-translate gestures;
- import a generated public HTTPS PNG/JPEG/WebP/AVIF, maximum 32 MiB;
- export native LightTable, PNG and PSD artifacts.

Image imports reject credentials, custom ports, loopback, private and
link-local destinations and revalidate redirects. Artifacts are opaque,
in-process and bounded to 32 entries / 512 MiB; binary content crosses only
the explicitly enabled host bridge.

Text, vector shape construction, gradient authoring, arbitrary effect setting
edits and document creation are **not yet semantic MCP commands**. They must be
added to the shared application command service first. Adding DOM selectors or
a parallel MCP-only scene format is forbidden.

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

`npm run smoke:mcp` performs a real protocol-to-desktop test. The 2026-08-06
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

## Next semantic slices

Implement in this order, each through the shared command service:

1. create document with explicit width/height/profile/background;
2. upload asset then place it as an editable layer in an existing document;
3. create/edit point and paragraph text with font substitution reporting;
4. create/edit vector shapes, fills, strokes and gradients;
5. add/update/remove canonical Layer Style effects;
6. batch transactions with one undo entry and an atomic revision precondition;
7. persistent task/event delivery for long agent jobs.

These additions turn the proven transport into the layered-design agent model
without compromising LightTable's single-authority architecture.
