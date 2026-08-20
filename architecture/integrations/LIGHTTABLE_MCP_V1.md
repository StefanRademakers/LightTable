# LightTable MCP v1 integration

Status: **implemented semantic integration**, updated 2026-08-14.

## Decision

MCP is a network adapter over the existing semantic LightTable command
service. It is not a second editor API, document model, undo stack or renderer.
Every edit enters the same typed commands and bounded gestures used by desktop
automation. Stable document/layer IDs, explicit document revisions and normal
history remain authoritative.

This document owns the current MCP implementation boundary. The broader,
multi-milestone product outcome is the
[`Agent-native creative runtime target`](../goals/AGENT_NATIVE_CREATIVE_RUNTIME_TARGET.md);
do not infer that target capability from this v1 integration status.

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
- list the compact editable layer tree in revision-bound cursor pages of at
  most 256 rows; list rows do not inline vector geometry;
- inspect targeted text, vector, Warp, basic Grade, complete processing-module
  parameters and Layer Style content by
  stable layer ID;
- query currently valid semantic commands;
- request a bounded whole-document PNG or WebP through LightTable's real
  renderer;
- request isolated layer pixels or a raster mask through the mounted GPU layer
  renderer without moving the artist viewport.
- request an exact document-pixel region through the same final-composite crop
  and encode owner as Copy Merged, without changing selection or viewport;
- inspect the current active layer, or one explicit layer ID, through a compact
  type-dispatched content summary before requesting heavier details;
- query reconnect-safe publication pages or wait up to 10 seconds for the next
  document, revision, active-layer, selection, history, task or renderer
  publication. A cursor gap remains explicit and requires canonical re-query.

Whole-document, region and layer previews require an exact canonical document
revision. `maxEdge` controls output size from 64-1024 pixels; PNG is lossless,
while WebP accepts an explicit `quality` from 0.1-1. Previews are cached by
revision, target/channel, size, format and quality. Supplying the
last `knownArtifactId` returns metadata only when the preview is unchanged, so
event-driven clients do not repeatedly transfer the same Base64 image.

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
preview, native and PSD artifacts. `lighttable_adjustment` now inspects
document Grade/Lens Fx, raster/Adjustment Layer processing and attached
adjustments through the shared module registry. It reports enabled and
default/non-default value state, bounds modules/arrays and never serializes
unknown renderer settings or LUT bytes. Remaining gaps include mutation
coverage for non-basic adjustment parameters and broad semantic coverage for
some tools. Those must be added to the shared
application command service first;
DOM selectors or a parallel MCP-only scene format remain forbidden.

### Exposure-list ownership

[`packages/command-contract/catalog.json`](../../packages/command-contract/catalog.json)
is the machine-readable authority for semantic command IDs and their explicit
application, Agent Access and external MCP profiles. Generated JavaScript and
TypeScript projections feed the application validator, transport-neutral
adapter and MCP Zod enums; a check fails when generated projections are stale
or an external command is absent from the downstream Agent Access profile.
The same entries now carry product category, label, description, scope, effect
class and local invocation metadata. The docked Actions panel consumes that
projection plus live capability results, so local discovery and MCP exposure
cannot acquire separate naming or categorization lists.

[`packages/command-contract/parameter-properties.json`](../../packages/command-contract/parameter-properties.json)
is the checked top-level property inventory for those commands. Generation
fails when a catalog command has no matching property entry or an orphaned
entry remains. Both the local Commands view and the read-only
`lighttable_commands` MCP discovery tool consume the generated projection.
These signatures remain legacy discovery metadata while commands are promoted
category by category to versioned JSON Schema modules under
[`packages/command-contract/schemas/`](../../packages/command-contract/schemas/).
The first complete layer slices cover rename, visibility, fill opacity, blend
mode, lock, duplicate, Layer via Copy, delete, move and clipping input/result
contracts. The complete Text slice adds point, paragraph and native Path Text
creation plus range replacement, conditional character/paragraph formatting
and layout. Separate layer, layer-structure and text modules keep this from
becoming one registry file; the generator discovers schema modules instead of
maintaining another central import list. The local Commands editor recursively
generates bounded nested fields and explicit optional groups without a free-form
command JSON executor. The command service, atomic batch executor and MCP
discovery/input gate consume the same merged projection.
Invalid fields, types, ranges, enums and transport-only private state are
therefore rejected before a document mutation or desktop bridge call.
Application-owned parsers still enforce contextual rules that JSON Schema
cannot decide, such as whether a stable layer ID exists in the requested
document. Commands marked `legacy-properties-only` by `lighttable_commands`
have not yet reached this contract bar and must not be described as complete.

The schema validator now enforces closed nested objects, integer bounds,
`allOf`/`anyOf`/`oneOf`, constants, negation and `if`/`then`/`else`. Text mode
requirements and paired range offsets therefore fail before a desktop bridge
call; document-relative checks such as target existence and range length remain
with the application owner. Schema evaluation occurs only on discrete command
execution, atomic operations and the local Commands form. Gesture samples and
paint/pointer previews do not import or invoke it.

The profiles intentionally describe current rollout state. Generic MCP
execution is narrower than the complete application command set, while
document creation and artifact-open are reserved for dedicated tools with
stronger input validation. PSD export is part of the proven remote design
workflow. Resize, document duplication/geometry and Face Warp are not exposed
yet; they are future capability slices rather than permanent exclusions.

The product target is agent access to all user-facing functionality. Expansion
must keep going through semantic commands, capability discovery and the normal
document/history/render authorities, with validation and representative proof
per slice. A broad pass-through to arbitrary internal state is not that target.

Electron main authenticates and bounds requests, then invokes the
renderer-owned automation driver through narrow IPC. The renderer enforces the
Agent Access command profile before reaching that full internal driver and
filters command capability discovery through the same profile.

Command origin is trusted call-site context rather than part of the serialized
command parameters. Normal UI calls default to `ui`, the authenticated adapter
marks remote execution as `mcp`, and Actions playback uses
`actions-playback` with recording disabled. This prevents playback from
recording itself while keeping agent edits visible in an explicitly active
recorder. A remote caller cannot claim a different origin through its payload.

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
test and currently uses the isolated development bridge fixture. Its 2026-08-20
run used `D:\shapes.psd`, traversed revision-bound layer pages, fetched both a
whole-document PNG, isolated 256-pixel WebP raster-layer preview at quality
0.72 and a 192×96 document region returned as 128×64 WebP, proved an
unchanged layer preview omitted image bytes, then exercised semantic edits and
exported all three artifacts. The packaged flow also read a native Curves
Adjustment Layer and an attached Brightness/Contrast node back through
`lighttable_adjustment` at their exact canonical revision. It now also starts a
bounded `lighttable_wait_for_events` read before a semantic edit and proves the
wait wakes without polling, then drains revision/history publications from the
returned reconnect cursor.

The packaged Commands smoke additionally creates editable point text through
the schema-generated nested origin controls, verifies its stable text layer,
content and transform, and keeps renderer status clean. The external MCP smoke
discovers `text.create` as a complete conditional schema, proves malformed Path
Text/private state does not advance the canonical revision, then executes real
point and native Path Text through the packaged desktop owner.

`npm run smoke:desktop:route-equivalence` separately proves the same wait over
the packaged outbound TLS/WSS device tunnel while a concurrent MCP call creates
a native vector. The first publication is `active-layer-changed`; a single
cursor drain then contains `history-changed` and the exact
`document-revision-changed`. Idle waits time out after at most 10 seconds, core
and tunnel concurrency are both bounded, and service disposal releases pending
waiters.
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
3. Grade/Lens Fx and non-basic adjustment mutation semantics;
4. remaining tool operations that can be expressed deterministically;
5. richer structural and visual inspection for reference-image reconstruction;
6. version negotiation, ID-lifetime and permission contracts suitable for a
   future plugin ABI.
