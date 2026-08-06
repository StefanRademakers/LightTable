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

Autosave, recovery journals and crash restoration are pre-1.0 requirements.
They must serialize canonical state/assets, not GPU caches or DOM layout
accidents.

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

## Test ladder

1. Pure domain and planning tests.
2. Command/history and serialization round trips.
3. Processing-order, exact bypass and cache invalidation tests.
4. Pixel/color/alpha/transform GPU fixtures.
5. PSD semantic import and Photoshop-reference comparisons.
6. Web build and browser smoke tests.
7. Electron dev and packaged smoke tests.
8. Cross-device interaction profiling, especially integrated Mac GPUs.

Every regression fix should add the narrowest stable test that would have
caught it. A UI screenshot is evidence, not a replacement for a model,
planning or pixel test.

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
