# Reliability and verification

Professional behavior means a failed codec, GPU pass, host save or async task
does not corrupt the document and does not fail silently.

## Atomic state changes

- Canonical document mutations happen through document-scoped commands.
- Preview state is disposable and commits once per gesture.
- Save writes a complete new result before replacing the previous durable
  target where the host permits atomic replacement.
- Closing, replacing or switching a document invalidates late callbacks with
  session and source-revision guards.
- Cancellation is a normal result; partial decode/render output is never
  installed as a successful document.

Crash recovery is a separate, private persistence lane. Version-1 recovery
stores complete canonical snapshots, never GPU caches or DOM layout accidents,
after semantic command commits only. A 5-second quiet debounce and 30-second
maximum dirty age feed a newest-only, single-writer queue; unchanged documents
have no recovery timer or recurring work. Electron uses private `userData` and
the atomic writer below. Browsers use OPFS with explicit quota/error results.
Two generations per document, 20 documents, 30 days and 2 GiB are retained.
Only a verified Save or explicit discard removes a valid checkpoint.

The schema, source research, privacy boundary, rejection policy and performance
evidence live in `contracts/RECOVERY_PERSISTENCE_ADR.md`. On startup the recovery
chooser appears before recents and offers Preview, Open recovered copy, Discard
and Later. Recovered documents stay dirty and Save targets a new file. Desktop
metadata is OS-encrypted; missing/moved and newer originals are reported rather
than guessed. A crash-attempt marker excludes a repeatedly failing document
from bulk restore while document-scoped runtime boundaries leave other tabs
usable. Browsers without durable recovery expose that limitation honestly.

## Native save transaction

One application-owned transaction governs File > Save and Ctrl/Cmd+S in every
host. It pins both the canonical document revision and command-history state,
then advances through `preparing`, `prepared`, `writing` and a terminal
`committed`, `canceled` or `failed` state. Serialization that becomes stale is
canceled before host I/O. A prepared revision that commits while newer edits
arrive remains a valid saved snapshot, but the open document stays dirty.

Electron writes a unique sibling temporary file with exclusive creation,
flushes and closes it, validates its length and known PNG/LightTable, PSD or PDF
container boundary, and only then publishes it. The normal path uses a sibling
rename. Hosts that reject replacement by rename use a bounded fallback: move
the previous target to a unique sibling backup, publish the complete temporary
file, and restore the backup if publication fails. The previous valid document
is never deleted before a replacement exists. Symbolic-link and non-file save
targets are rejected.

Browser downloads use the same application result contract but report
`download` durability; they do not claim atomic replacement. Dialog cancel and
phase-specific failures are normal structured results. Successful saves are
quiet status updates, while failure text retains the failing phase and cause.

Exports share the host byte writer but never change document dirty state. A
normal Save does not close the document. Autosave and recovery consume this
transaction in later tasks rather than adding a second durable-write path.

## Error boundary

Errors identify subsystem, phase, document and underlying cause. WebGPU shader
creation and command submission use validation scopes. A failed optional
pipeline disables/reports that feature without making ordinary image loading
unavailable when isolation is possible.

Device loss destroys resource graphs and offers a clean renderer rebuild from
canonical state. React Strict Mode mount/unmount is treated as a lifecycle
test: disposal is idempotent and subscriptions never retain disposed owners.
The hybrid vector path must release/recreate the shared Vello/native device
graph, detect a missing bounded Rust scene and rehydrate it from canonical-
derived PaintScene. A renderer-only SVG preview may disappear during recovery;
it must never be substituted for canonical content.

Automatic GPU recovery is conditional on reconstructability. Canonical vector
and other reconstructable documents may rebuild a fresh renderer and must
return pixel-identically. A raster document whose authoritative pixels, masks,
patterns or LUT resources exist only on the lost device enters an explicit
checkpoint-required failure state; LightTable must not present an empty
replacement as recovery. `audit-desktop-device-loss.mjs` exercises both
policies against a packaged application.

## Test ladder

Support diagnostics follow the local-only, bounded and centrally redacted
contract in `PRIVACY_AND_SUPPORT_DIAGNOSTICS.md`. Collection is user-triggered,
uses existing snapshots and cannot invoke a renderer recomposition or readback.

1. Pure domain and planning tests.
2. Command/history and serialization round trips.
3. Processing-order, exact bypass and cache invalidation tests.
4. Pixel/color/alpha/transform GPU fixtures.
5. PSD semantic import and Photoshop-reference comparisons.
6. Web build and browser smoke tests.
7. Electron dev and packaged smoke tests.
8. Cross-device interaction profiling, especially integrated Mac GPUs.

The architecture-stability packaged set includes document pixel retention,
active-layer and layer-selection stability, screen/workspace modes, tool
switching, scope wake-up, adjustment presentation, source save, OS-open,
device-loss policy and exact UI/Actions/MCP route equivalence. These routes are
focused regression gates, not a substitute for owner interaction testing or a
multi-hour supported-hardware soak.

The desktop/full profiles also run the bounded supported-hardware soak. Its
`overnight` profile covers at least twelve requested hours; shorter profiles
must retain their explicit `not-measured` extrapolation. See
`SUPPORTED_HARDWARE_AND_SOAK_GATE.md`.

Every regression fix should add the narrowest stable test that would have
caught it. A UI screenshot is evidence, not a replacement for a model,
planning or pixel test.

For first-pixel claims, a canvas screenshot proves that useful pixels were
presented only when paired with monotonic startup events, queue completion and
a browser paint opportunity. The harness must then wait for the editable
canonical/island result and reject blank output, renderer errors or a preview
that masks final-render failure.

## Release gates

- No known data-loss path for supported files/actions.
- Native save/open round trips preserve all advertised editable semantics.
- Export states actual bit depth, profile and flattening.
- No recurring GPU/CPU work for unchanged background documents.
- Ordinary PNG/JPEG/WebP remains on the fast path.
- Required web and Electron matrices are green.
- Unsupported Photoshop features are explicit in the import report.
- Accessibility and desktop keyboard behavior are deliberately tested rather
  than removed with blanket focus styling.

Metrics are useful only with validity metadata. Zero samples, canceled work or
a missing reference is “unavailable”, never a perfect score.
