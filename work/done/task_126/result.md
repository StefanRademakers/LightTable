# Result

- Histogram drawing now reacts to the scopes canvas becoming measurable/visible through `ResizeObserver`.
- The existing histogram snapshot is redrawn; toggling scopes no longer has to request a new GPU histogram.
- App typecheck passes.
