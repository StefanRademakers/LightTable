# LightTable MCP server v0.1

This package is the remote Streamable HTTP adapter for LightTable's semantic
application command service. It deliberately contains no document model and no
renderer. A token-protected, loopback-only desktop bridge owns the connection
to the real editor.

Focused tools cover bounded workspace/layer/text/vector inspection, semantic
document/text/shape creation, text/vector edits and Layer Style mutations.
They invoke the editor's canonical commands; this package never creates its
own glyph runs, vector geometry, effects, undo state or pixels.

Atomic layered design steps use `lighttable_batch`; reconnect-safe progress is
available through `lighttable_task_events`, and `lighttable_cancel_task` stops
active work. Successful batches appear as one named undo entry in LightTable.

## Local demo

```powershell
$env:LIGHTTABLE_PAIRING_CODE='replace-with-a-random-code'
$env:LIGHTTABLE_DEMO_MODE='true'
$env:LIGHTTABLE_ALLOW_INSECURE_HTTP='true'
npm run mcp:server
```

The demo exposes mock state and is only useful for MCP/OAuth client testing.

Desktop devices can pair over `/agent/pair` and connect outbound over
`/agent/tunnel`. Configure a one-time `LIGHTTABLE_DEVICE_PAIRING_CODE` and a
stable `LIGHTTABLE_SERVER_ID`; production requires the same HTTPS origin and a
WSS-capable reverse proxy. The desktop pins the observed certificate. The
single-process broker is the bounded trial implementation; durable multi-user
state is part of the production service milestone.
Run `npm run smoke:mcp` for the real Electron end-to-end path.

## Real desktop bridge

Terminal 1:

```powershell
$env:LIGHTTABLE_BRIDGE_TOKEN='<at-least-24-random-characters>'
npm run mcp:bridge -- --file D:\shapes.psd
```

Terminal 2:

```powershell
$env:LIGHTTABLE_PUBLIC_URL='http://127.0.0.1:8787'
$env:LIGHTTABLE_ALLOW_INSECURE_HTTP='true'
$env:LIGHTTABLE_PAIRING_CODE='<one-time-code-shown-to-the-user>'
$env:LIGHTTABLE_BRIDGE_URL='http://127.0.0.1:8790'
$env:LIGHTTABLE_BRIDGE_TOKEN='<same-bridge-token>'
npm run mcp:server
```

HTTP is rejected unless the explicit local-test flag is set. The desktop
bridge always binds to `127.0.0.1`; never publish it directly.

## Verification

- `npm test -w @lighttable/mcp-server`
- `npm run smoke:mcp -- D:\shapes.psd D:\mediavibe\LightTableTestFiles\mcp`

The command-driver and MCP tests cover editable text, vector/gradient/stroke
and Layer Style commands. The MCP smoke creates a real editable raster layer,
paints a gesture, renders through LightTable and writes PNG, native and PSD
artifacts.
