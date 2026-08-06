# LightTable MCP production runbook

Status: release candidate, 2026-08-06. This runbook covers the bounded
single-process/single-tenant server-backed Agent Access route.

## Deployment boundary

Run one Node 20+ service and one encrypted state prefix per tenant. The desktop
opens outbound HTTPS/WSS only; never expose its loopback bridge. Caddy or nginx
terminates public TLS and must proxy WebSocket upgrades for `/agent/tunnel`.
Do not put two server processes behind one state prefix: the JSON state store
uses atomic replacement, not cross-process transactions. Horizontal scaling
requires a future transactional OAuth store and shared tunnel broker.

Required secrets/configuration:

```text
LIGHTTABLE_PUBLIC_URL=https://agent.example.com
LIGHTTABLE_ALLOWED_HOSTS=agent.example.com
LIGHTTABLE_PAIRING_CODE=<short-lived OAuth owner code, 8+ chars>
LIGHTTABLE_DEVICE_PAIRING_CODE=<single-use desktop code, 6+ chars>
LIGHTTABLE_DEVICE_ID=<paired 24-hex desktop identity>
LIGHTTABLE_CLIENT_ID=lighttable-mcp
LIGHTTABLE_SERVER_ID=agent-eu-1
LIGHTTABLE_TENANT_ID=<opaque tenant id>
LIGHTTABLE_USER_ID=<opaque owner id>
LIGHTTABLE_STATE_PATH=/var/lib/lighttable-mcp/state
LIGHTTABLE_STATE_SECRET=<random 32+ character secret from secret store>
PORT=8787
HOST=127.0.0.1
```

Supply secrets with systemd credentials, an environment file readable only by
the service user, or the hosting secret store. Never commit them or pass them
on the command line. `LIGHTTABLE_ALLOW_INSECURE_HTTP` and
`LIGHTTABLE_AGENT_ALLOW_LOCAL_TLS` are test-only and forbidden in production.

Example systemd unit:

```ini
[Unit]
Description=LightTable MCP server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=lighttable-mcp
Group=lighttable-mcp
WorkingDirectory=/opt/lighttable
EnvironmentFile=/etc/lighttable-mcp/environment
ExecStart=/usr/bin/node apps/mcp-server/src/index.mjs
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/lighttable-mcp

[Install]
WantedBy=multi-user.target
```

The reverse proxy must cap request bodies at 1 MiB, preserve `Host`, and proxy
WebSocket upgrade headers. Artifacts are chunked over the authenticated tunnel
and bounded to 32 MiB. `/health` is the liveness probe; `/ready` stops returning
200 as soon as graceful shutdown begins.

## Backup and restore

Back up both `${LIGHTTABLE_STATE_PATH}.oauth` and `.audit` together with their
file metadata. They are ciphertext; store `LIGHTTABLE_STATE_SECRET` separately
in the secret manager. A consistent single-process backup is:

1. stop the service or take a filesystem snapshot;
2. copy both files to encrypted backup storage;
3. restart and verify `/ready`;
4. periodically restore into a staging instance using the same secret and
   verify an existing refresh token plus bounded audit history.

To restore, stop the target, place both files at the configured prefix with
owner `lighttable-mcp` and mode `0600`, restore the matching secret, then start.
A missing file starts empty; a wrong secret fails closed during startup. After
a suspected secret leak, discard state, rotate the secret and require OAuth and
desktop re-pairing.

## Release gates and measured limitations

Run:

```powershell
npm run typecheck -w @lighttable/mcp-server
npm test -w @lighttable/mcp-server
npm run package:desktop
npm run smoke:desktop:agent-tunnel
npm run smoke:desktop:mcp-design
```

The deterministic design smoke creates a 1080x1350 layered card, uploads an
asset, adds editable gradient/vector, point/paragraph text and Drop Shadow,
exports native/PSD, reopens in LightTable and Photoshop, and writes a visual
side-by-side. On the 2026-08-06 Windows/Photoshop 27.8 gate it preserved two
Photoshop type layers and one vector-fill layer; LT-vs-Photoshop RMSE was 9.79.

Known bounded limitations:

- `ag-psd` cannot synthesize Photoshop's global text-engine resource. Exported
  type layers therefore include LightTable's exact GPU raster fallback plus
  TySh edit data. They render immediately; Photoshop may request a text update
  when editing and may substitute Inter if it is not installed.
- The tunnel broker is memory-resident. Desktop reconnect survives ordinary
  network loss, but server restart drops live sockets and pending requests.
- One service instance is one tenant. Process/state-directory isolation is the
  production boundary until a shared transactional broker is implemented.
- Photoshop font and Layer Style kernels still account for the remaining
  visual difference; absence of content or silent raster-only layer fallback
  is a release failure.
