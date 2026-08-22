# Paint scene

`@lighttable/paint-scene` is the deliberately small, renderer-neutral input
contract used to compare rendering backends. It is derived and disposable:
LightTable documents and format-specific source models remain authoritative.

The first schema slice supports exact move/line/cubic/close paths, solid fills,
centered solid strokes and affine transforms. Paths are revisioned once per
fragment and paint commands reference them by id, so fill/stroke serialization
does not duplicate heavy geometry. Capability loss is never implicit:
adapters must return an issue for every unsupported, omitted or reduced feature,
and a result containing issues cannot have `ready` status.

Format adapters live in `@lighttable/paint-scene-adapters` so neither source
cores nor this backend contract depend on one another. Expand the schema only
after current-WebGPU/Vello parity evidence requires and validates a feature.
