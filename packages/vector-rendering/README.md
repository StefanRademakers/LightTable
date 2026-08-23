# @lighttable/vector-rendering

Host-independent realization and cache contracts between vector documents and
rendering backends. This package may derive immutable render data from
`@lighttable/vector-core`, but does not own DOM, React, WebGPU or Electron state.

The key boundary is intentional:

- serialized paths remain in `vector-core`;
- flattened document-space geometry and revision keys live here;
- backend resources and command encoding belong to a backend package;
- viewport pan does not invalidate document-space geometry;
- every cached backend resource must have explicit disposal.

Application-level render-island planning is deliberately outside this package.
An island may combine several independently editable canonical layers for one
retained backend surface, but it consumes the same immutable geometry/revision
contracts and never changes document IDs or ownership.
