# @lighttable/vector-svg

Bounded editable SVG import planning and symmetric SVG export over
`@lighttable/vector-core` and canonical paint semantics. XML is transient input;
the output is editable paths, live primitives, admitted gradients, opacity
groups and local vector clips with structured conversion warnings.

Untrusted product input reaches this codec through
`@lighttable/vector-svg-normalizer`. The package performs no network/file
resolution and never retains an SVG DOM or renderer scene as document state.
