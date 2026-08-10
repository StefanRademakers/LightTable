# Task 115 progress - 10 August 2026

Task 115 is current and remains actionable.

Already present as a baseline are canonical document merge plans, semantic
mixed-layer merging, non-contributing lazy-layer handling, unit matrices and
the packaged `smoke:desktop:layer-merge-matrix` workflow. Task 115 was created
after those repairs and deliberately addresses the remaining systemic gap.

Still open:

- one typed operation plan/result contract shared by capability UI, command
  execution and GPU preflight for every destructive operation;
- structured failure codes instead of generic controller/GPU error strings;
- generated coverage across all layer kinds, nesting, clipping, masks,
  transforms, lazy resources and readiness states;
- a generic packaged interaction monitor that fails on unexpected user-visible
  errors, accepted no-ops and unchanged revisions;
- enforced successful/disabled-reason coverage for every enabled command.
