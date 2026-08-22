# @lighttable/vector-svg-normalizer

Reusable, renderer-independent normalization of untrusted static SVG into a smaller SVG subset.

The package owns only syntax normalization and its security/resource budgets. It does not own the
editable LightTable vector model, `PaintScene`, or a GPU backend. External resources, data URLs,
active elements, event attributes and DTD-bearing XML are rejected at the native boundary. Both
`usvg` image resolvers are disabled explicitly.

Dependency direction:

`untrusted SVG -> vector-svg-normalizer -> vector-svg -> vector-core -> paint-scene -> renderer`

