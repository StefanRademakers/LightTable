# Privacy and support diagnostics

LightTable support diagnostics are local, explicit and inspectable. Opening a
document does not start telemetry. Pressing **Preview**, **Copy summary** or
**Export bundle** in the Debug panel is the only collection trigger, and no
diagnostic bundle is uploaded by LightTable.

## Diagnostic contract

Schema `com.lighttable.support-diagnostics` version 1 contains:

- application version, build, channel and host kind when the host exposes it;
- the already-initialized GPU adapter identity and negotiated feature names;
- document media type, dimensions, bit depth, color profile and layer count;
- bounded warnings/errors and at most 100 recent events within 64 KiB;
- existing startup timing and owned GPU/text-cache estimates;
- validity, availability and privacy metadata.

Unavailable measurements remain `{ status: "unavailable", reason }`. They are
never emitted as zero. Collection consumes immutable presentation snapshots and
has no renderer/canvas port, so it cannot schedule composition, allocate GPU
resources or read pixels back. The generated JSON includes a redacted
`summary.txt` attachment and can be previewed before it is saved through the
normal host save boundary.

Paths, URLs, bearer credentials, pairing/access tokens, document-content
markers, data URLs and binary payloads pass through one redaction boundary.
The filename is excluded by default and requires an explicit checkbox. The
bundle never contains document pixels, text-layer contents, serialized scene
data, font bytes, recovery payloads or source files.

## Other network boundaries

- Depth estimation downloads the declared Depth Anything model on first use,
  then sends the selected image blob only to the local Web Worker for local
  WebGPU/WASM inference. It is not a remote image-inference upload.
- Bundled font and development-corpus fetches load application assets; they do
  not transmit document content.
- The optional MCP server is an explicit remote integration. Commands, compact
  document/layer query results, requested previews and explicitly exported or
  imported artifacts cross its authenticated bridge. Binary artifacts cross
  only when the user-enabled MCP operation requests them; see
  `integrations/LIGHTTABLE_MCP_V1.md`.
- Future remote AI providers must identify the exact pixels/text/metadata sent,
  recipient, retention policy and user consent before gaining a production
  command. They may not reuse the diagnostic path as an upload channel.
- Release update checks fetch release metadata and artifacts only; no open
  document metadata or diagnostic bundle accompanies those requests.

Recovery remains a separate private local persistence lane. Its encrypted
metadata and canonical snapshots are not diagnostic inputs.

The optional design-partner beta event lane follows the same local-first rule.
It is disabled by default, retains only bounded enum records with hourly time
buckets and has no free-text field. Revoking consent deletes its local storage.
When enabled, its exact snapshot is included in the inspectable bundle; it is
still never uploaded automatically. See `BETA_PRIVACY_AND_DEFECT_TRIAGE.md`.
