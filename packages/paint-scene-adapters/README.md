# @lighttable/paint-scene-adapters

Pure capability-reporting projections from canonical/source models into
`@lighttable/paint-scene`. Current adapters cover native LightTable vector
content, retained cross-layer render islands and the admitted PDF path subset.

Adapters preserve stable fragment/path revisions and must report every omitted,
unsupported or reduced semantic. A result with capability issues cannot be
labelled `ready`. The package owns neither source parsing nor backend resources.
