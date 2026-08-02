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
