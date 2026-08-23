# Paint scene

`@lighttable/paint-scene` is the deliberately small, renderer-neutral input
contract used to compare rendering backends. It is derived and disposable:
LightTable documents and format-specific source models remain authoritative.

The current schema supports exact move/line/cubic/close paths, affine
transforms, solid and sampled gradient paint, centered strokes, fragment-local
clip stacks, retained hidden fragments and nested isolated opacity composition.
Paths are revisioned once per fragment and paint commands reference them by id,
so fill/stroke serialization does not duplicate heavy geometry. Stable
cross-layer fragments may be composed into a render island without merging
canonical layers. Capability loss is never implicit:
adapters must return an issue for every unsupported, omitted or reduced feature,
and a result containing issues cannot have `ready` status.

Format adapters live in `@lighttable/paint-scene-adapters` so neither source
cores nor this backend contract depend on one another. Expand the schema only
after current-WebGPU/Vello parity evidence requires and validates a feature.
