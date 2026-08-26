# LightTable MCP v1 integration

Status: **implemented semantic integration**, updated 2026-08-24.

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
rotatable high-entropy device token. Its direct address/token controls remain
under **Preferences > Agent Access > Advanced** for diagnostics and the legacy
private-tunnel route. Stopping it closes listeners without closing documents.
The normal local Codex route uses the built-in loopback MCP service instead. See
[Embedded desktop Agent Access](EMBEDDED_AGENT_ACCESS.md).

For the Hetzner trial, create an outbound reverse SSH tunnel from the desktop:

```powershell
ssh -N -R 127.0.0.1:8790:127.0.0.1:8790 lighttable@SERVER
```

The MCP process on the server then uses
`LIGHTTABLE_BRIDGE_URL=http://127.0.0.1:8790`. Do not bind the desktop bridge to
a public interface. OpenAI's Secure MCP Tunnel is another suitable private
transport when it is available for the target workspace.

The production-oriented route no longer needs SSH: Preferences pairs once over
HTTPS, pins the server identity and opens WSS outbound from the desktop. Client
read/edit scopes require explicit desktop approval. See
[Outbound Agent server pairing](OUTBOUND_AGENT_PAIRING.md).

## V1 tool surface

Read operations:

- request one bounded current-context snapshot that combines the workspace,
  active or explicit document, active or explicit layer summary and live
  editor capabilities; this is the preferred first read because it removes
  model/tool roundtrips without creating another state owner;
- inspect workspace, document dimensions/aspect/revision/viewport and current
  bit depth, working/blend profile and assigned-versus-assumed profile state;
- list the compact editable layer tree in revision-bound cursor pages of at
  most 256 rows; list rows do not inline vector geometry;
- inspect targeted text, vector, Warp, basic Grade, complete processing-module
  parameters and Layer Style content by
  stable layer ID;
- query currently valid semantic commands;
- request a bounded whole-document PNG or WebP through LightTable's real
  renderer;
- extract 1-256 deterministic, coverage-ranked real colors from the exact
  final composite revision without transferring or parsing preview bytes;
- request isolated layer pixels or a raster mask through the mounted GPU layer
  renderer without moving the artist viewport.
- request an exact document-pixel region through the same final-composite crop
  and encode owner as Copy Merged, without changing selection or viewport;
- inspect the current active layer, or one explicit layer ID, through a compact
  type-dispatched content summary before requesting heavier details. Layer
  list/detail projections include revision-bound conservative document and
  visual bounds from the same geometry query used by snapping and hit-test
  broad phase; exact alpha/path/mask tests remain authoritative for hits;
- query reconnect-safe publication pages or wait up to 10 seconds for the next
  document, revision, active-layer, selection, history, task or renderer
  publication. A cursor gap remains explicit and requires canonical re-query.
- inspect a bounded process-local latency timeline with aggregate p50/p95/max
  durations for MCP tools and their nested LightTable bridge/command calls.
  Tool and bridge durations overlap; Codex startup, model reasoning and client
  scheduling remain explicitly outside this measurement.

Whole-document, region and layer previews require an exact canonical document
revision. `maxEdge` controls output size from 64-1024 pixels. The economical
default is a directly encoded 512-pixel WebP at quality 0.78; PNG remains the
explicit lossless option for alpha and pixel-level checks. The GPU preview is
read back once at its requested size and encoded directly to the requested
media type; WebP no longer passes through an intermediate PNG decode/encode.
Previews are cached by
revision, target/channel, size, format and quality. Supplying the
last `knownArtifactId` returns metadata only when the preview is unchanged, so
event-driven clients do not repeatedly transfer the same Base64 image.

Write operations:

- create documents through the dedicated creation tool;
- create/place/rename/show/hide raster layers and set fill opacity;
- explicitly rasterize one supported layer through the shared reversible
  `layer.rasterize` command when destructive finalization is intended;
- query, create and edit point/paragraph text and layout/style runs;
- query, create, update and remove editable vector elements, shapes, fills,
  strokes and gradients;
- import one generated SVG string up to the shared 32 MiB byte limit through
  `lighttable_import_svg`; the
  shared `vector.importSvg` owner creates native editable paths/primitives in
  one atomic change rather than rasterizing or emitting point-level calls;
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

`adjustment.create` accepts validated initial settings for Posterize, Threshold
and Gradient Map. Those settings are applied during node construction, so one
MCP command produces one editable node and one history publication. Gradient
Map uses the canonical document color/opacity-stop representation plus reverse,
dither and interpolation; it does not expose renderer-private gradient state.
Other adjustment families still use their canonical defaults until their own
closed mutation contracts are promoted.

The artist-onboarding resource now directs clients to call
`lighttable_context` once, retain stable IDs/revisions and capability decisions
for the session, query only the command schemas required by the planned work,
batch logical edit phases, wait for accepted batch work to finish and preview
only after a phase. Completed async task queries expose monotonic elapsed and
final duration. `lighttable_performance`
is the final diagnostic read when a flow feels slow; it separates MCP handler
time from bridge/command time but cannot attribute time spent starting or
reasoning inside Codex.

The versioned `lighttable://guides/design-pass` resource adds the design-specific
layer above that transport workflow. It asks an agent to form a concise brief,
plan hierarchy/composition/type/palette/layer structure, build in atomic
large-to-small phases, review with structure first and economical previews
second, rank a bounded correction set and finish with fresh structural and
visual evidence. Server initialization instructions point design tasks to this
guide without copying the full guide into every tool description.

Measured evidence on the Windows development workstation (24 August 2026): a
12-sample deterministic Chromium codec benchmark reduced median 512-pixel WebP
encoding from 31.00 ms for the former PNG transcode to 23.73 ms direct, with
the same 112,936-byte fixture output. A second run measured 38.67 ms versus
28.45 ms. A warm packaged LightTable design document then returned its real
revision-bound 512-pixel WebP through renderer, desktop tunnel, MCP and Base64
in 30.80 ms (8,108 bytes). These are local pipeline measurements; remote model
reasoning, network scheduling and vision inference are deliberately excluded.

Inactive documents are not required to own a hidden canvas or persistent GPU
renderer. A ready, clean, single-raster document can serve its document preview,
source-layer preview and full pixel-copy through a bounded source-artifact path
without changing the active tab. Edited, selected, processed or layered content
fails closed until it is rendered canonically; the service never substitutes an
old source image for current document pixels. Multi-file Open serializes initial
publication through the one application renderer so no background tab remains
stuck in `opening` merely because React mounted only the final selection.

### Exposure-list ownership

[`packages/command-contract/catalog.json`](../../packages/command-contract/catalog.json)
is the machine-readable authority for semantic command IDs and their explicit
application, Agent Access and external MCP profiles. Generated JavaScript and
TypeScript projections feed the application validator, transport-neutral
adapter and MCP Zod enums; a check fails when generated projections are stale
or an external command is absent from the downstream Agent Access profile.
The same entries now carry product category, label, description, scope, effect
class and local invocation metadata. Actions records this same semantic route;
it does not maintain a second mutation or command-discovery table.

Durable Actions use one current alpha workflow envelope: at most 16 named sets,
32 Actions and 32 typed variables per Action. There are no compatibility
versions or migration registries before the product reaches 1.0. Set names,
selection, variables, explicit parameter/
result bindings and optional trimmed 280-character user-facing step rationales
are local workflow metadata; they do not enter document state, command
parameters or create parallel MCP mutation commands. Unknown/private step
fields in the current envelope fail closed. Playback
resolves defaults or typed overrides and prior results before the same shared
command-schema preflight used to guard each recorded semantic command. The
local recorded-step editor also consumes these generated schemas; it does not
maintain a command-specific form catalog, invent a mutation route or alter MCP
command contracts. An obsolete or malformed envelope fails atomically.

Ordinary playback remains stepwise.
Eligible Actions automatically play as one undo. The compiler accepts only
stopped, completed, same-document steps whose commands are already in the generated atomic-batch
contract. Variable values resolve before execution; top-level prior-result
bindings become native batch references. Diagnostic/async steps, workspace or
multi-document flows, nested result paths and non-batch commands fail before
the single `command.batch` request. This local workflow choice does not add an
MCP method or make additional commands remotely eligible.

[`packages/command-contract/parameter-properties.json`](../../packages/command-contract/parameter-properties.json)
is the checked top-level property inventory for those commands. Generation
fails when a catalog command has no matching property entry or an orphaned
entry remains. Both the local Commands view and the read-only
`lighttable_commands` MCP discovery tool consume the generated projection.
These signatures remain legacy discovery metadata while commands are promoted
category by category to versioned JSON Schema modules under
[`packages/command-contract/schemas/`](../../packages/command-contract/schemas/).
The complete layer slices cover rename, visibility, fill opacity, blend
mode, lock, duplicate, Layer via Copy, delete, move and clipping input/result
contracts. The complete Text slice adds point, paragraph and native Path Text
creation plus range replacement, conditional character/paragraph formatting
and layout. Adjustment creation and Auto Align now also have closed contracts.
Auto Align exposes only stable target IDs and whether geometry changed; estimator
model, confidence, diagnostics, preview reuse and correction matrices remain
inside the application. Committed Paint/Selection/Translate recipes and Warp
strokes are likewise closed: sample arrays are bounded, complete nested brush
and Warp state is validated, and pointer IDs, preview/debug state and runtime
renderer objects are excluded. View zoom, Undo/Redo, task cancellation and
native/PNG/PSD export also have closed contracts: export results carry bounded
opaque metadata and never paths, bytes or Base64. Separate layer,
layer-structure, text, adjustment, alignment, view, history, task and artifact modules keep this from
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
Every externally executable command is now complete. `command.batch` is derived
from the commands marked atomic-batch compatible and their existing input/result
schemas, rather than duplicating Text, Vector and Layer Style definitions in a
new handwritten registry. Its closed operation union permits bounded prior-
operation references on matching named result properties; the application
resolves each reference in order and validates the resolved value against the
original command schema again before execution. Missing, forward, private and
type-incompatible references therefore publish nothing.

The full derived batch schema is about 65 KiB and is intentionally returned on
demand by `lighttable_commands(command.batch)`, not copied into every MCP
`tools/list` response. The always-advertised `lighttable_batch` tool keeps a
compact operation envelope and validates the complete shared contract before
calling the desktop bridge. The local Commands view consumes that same full
contract and renders editable object arrays, constants and result-reference
variants without an arbitrary JSON field.

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
workflow. Document duplication is now admitted after its remote identity/result
proof; experimental Face Warp remains explicitly withheld pending its parked
visual and product gates.

`document.create` now has one closed shared workspace contract. New Document,
the local Commands view and `lighttable_create_document` use the same numeric
bit depth, profile and transparent/solid background values; the former MCP-only
string bit depth and `backgroundColor` alias no longer exist. Individual
dimensions are schema-bounded, while the application owner retains the
contextual 268,435,456-pixel product limit. Workspace commands reject a
`documentId`. Actions replay maps the document ID returned by a recorded
workspace creation to the fresh ID returned during replay, so subsequent
document-scoped steps edit the newly created document instead of the document
that happened to be active before playback.

`document.resizeImage` and `document.applyGeometry` now use one modular closed
document-geometry schema. Image Size bounds dimensions, resolution, resampling
method, Preserve Details noise reduction and style scaling. Geometry is an
exact four-way union for Canvas Size, Crop, orthogonal/arbitrary Rotation and
Flip; cross-operation fields, private preview state, oversized dimensions and
unstable angles fail before the desktop bridge. Results report the actual
post-commit canvas, not requested values echoed before execution. The local
schema-driven Actions editor, normal dialogs/menus and generic MCP execution
all reach the existing document/GPU/history owners. Packaged proof records
Image Size plus Rotate in the normal UI, replays the Action on a fresh document
and executes the same pair through external MCP; all three routes produce equal
layer/history state and byte-exact rendered pixels. Crop handles, dialog
previews and pointer samples remain local. The detailed geometry regression
also gates selection-bound Crop and exposed a corrected 64-byte WGSL uniform
layout that previously invalidated the mask-transfer command buffer.

`document.assignProfile` is a separate closed metadata operation. It currently
accepts only the document model's sRGB working profile and deliberately rejects
pixel-conversion flags, ICC bytes and unsupported profile names. The Edit menu,
Actions replay and external MCP share the document mutation/history owner; a
repeat assignment returns `changed: false` and creates no history entry.
Packaged proof starts from an untagged PNG, verifies the assigned state and one
undo entry through all three routes, and compares every result with the source
at zero pixel delta. This is not Convert to Profile support.

`document.duplicate` is the source-scoped workspace fork used by Image >
Duplicate, Actions and external MCP. Its closed contract accepts only a safe
new document name: source paths, overwrite targets, flatten switches and pixel
payloads are rejected before the desktop bridge. An expected source revision
prevents a remote fork from silently capturing a newer edit. The operation
exports through the existing self-contained native boundary, remaps document,
layer and asset identities, opens one independent unsaved document and leaves
source revision, dirty state and history untouched. Actions maps the recorded
duplicate result ID to the fresh fork on every replay so subsequent steps edit
the new copy. Packaged UI/Actions/MCP proof duplicates a raster/vector/text
composition, adds one layer only to each fork, compares editable structure and
reports byte-exact equal rendered pixels.

`selection.copyPixels` is the bounded pixel-clipboard producer for active-layer
and merged selections. The existing renderer performs the GPU capture and the
UI host still writes the system image clipboard, while the command result
publishes only finite document bounds and opaque `pixel-clipboard` artifact
metadata. `selection.pastePixels` consumes that handle through the existing
history owner. Its explicit bounds preserve the artifact's natural pixel size;
`target.channel: "pixels"` creates a raster layer while `"mask"` writes into
the named layer's existing mask without creating a layer. Selection- or
viewport-centered placement is a UI policy and should be resolved to final
document bounds before an MCP command is submitted.
A private generation token preserves the same-document active-layer GPU fast
path for a future explicit Paste in Place operation; normal Paste deliberately
uses the bounded artifact so its resolved center is honored.
Actions binds Paste to the fresh artifact ID returned by the preceding Copy
step, so replay does not persist session-local pixel data. External MCP can
execute the same pair with edit permission; raw
bytes, Base64, paths and GPU state are rejected or never serialized.
Packaged UI/Actions/MCP proof covers both Copy variants and the active-layer
artifact Paste, confirms copy is
revision/history neutral and reports byte-exact equal pasted renders. This is a
discrete I/O route and does not enter any paint, warp or pointer hot path.

`grade.copy` captures the complete current Grade recipe plus an optional
embedded 3D Look in one bounded, session-scoped `grade-clipboard` artifact.
Lens FX remains destination-owned and is deliberately excluded. Commands,
recorded Actions and MCP receive only artifact identity and metadata; LUT bytes,
Base64 and host paths never enter their JSON. `grade.paste` consumes that
artifact through the existing Grade transaction/history owner, reuses an
already-loaded immutable LUT in the source document and imports a fresh asset
only when the destination does not own it. Actions binds Paste to the fresh
Copy result on every replay. Packaged proof with an embedded Look records the
normal Edit-menu route, replays it through Actions and executes it through an
authenticated external MCP client: all routes create the same two logical
edits and render byte-exact equal 1448x1086 pixels. A separate cross-document
case proves the embedded Look and its 62% strength survive transfer.

A local Codex acceptance route is tracked in
[`work/todo/task_264_local_codex_mcp_a_z/task.txt`](../../work/todo/task_264_local_codex_mcp_a_z/task.txt).
The current acceptance instructions live in
[`LOCAL_CODEX_MCP_ACCEPTANCE.md`](LOCAL_CODEX_MCP_ACCEPTANCE.md). The normal
packaged route starts the loopback MCP server and Codex authorization from
Preferences; the isolated launcher remains available for clean denial and
scope-escalation tests. A newly registered MCP server still becomes visible
only after a fresh/reloaded Codex session.

A real fresh Codex client has already completed OAuth, explicit read/edit
approval, capability discovery, reference inspection, twelve-layer editable
construction and a revision-bound preview through MCP only. Task 264 remains
open for native save/export, independent packaged pixel/layer verification and
fresh-client invalid/stale/reconnect/cleanup evidence. Do not describe either
the first construction or the automated A-Z harness as that complete owner
acceptance.

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

Stepwise Action debugging is dependency-aware. Play Step resolves the
transitive producer steps required by `$lighttableResult` bindings and then
runs only the selected step. Play From Here adds those prerequisites to every
replayable step from the chosen point onward. A later step recorded in a fresh
document returned by `document.create` or `document.duplicate` also depends on
that document producer, even when no parameter contains a result binding.
Original order, schema preflight, task waiting, Stop and playback recording
isolation remain unchanged. Missing, forward or non-replayable producers are
not replaced by stale recorded state; the existing binding/target gate fails
closed. Packaged proof starts from the second step of Duplicate -> Create Layer,
runs the required Duplicate producer first and edits the fresh fork.

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

1. layer reparenting with explicit insertion semantics;
2. richer selection and mask properties;
3. remaining Grade/Lens Fx mutation semantics beyond Basic Grade and Detail;
4. remaining tool operations that can be expressed deterministically;
5. richer structural and visual inspection for reference-image reconstruction;
6. version negotiation, ID-lifetime and permission contracts suitable for a
   future plugin ABI.
