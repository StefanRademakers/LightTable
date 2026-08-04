# LightTable architecture

This directory is the durable system context for LightTable. It exists so a
new engineer, AI agent, web host or desktop host can recover the product model
without reconstructing it from chat history or historical implementation
notes.

## Authority

Use this order when sources disagree:

1. Current code and tests.
2. The contracts in this directory.
3. Current task specifications under `work/todo/` and fixtures.
4. Supporting material under `reference/`.
5. Completed work under `work/done/`, retired material under `obsolete/`, and
   source-control history.

Files under `reference/` explain research or implementation history but are not
canonical contracts. Files under `obsolete/` are retained only when their
history still has value. Keep temporary task notes out of this directory.

## Reading order

1. [Product and principles](PRODUCT_AND_PRINCIPLES.md)
2. [System map](SYSTEM_MAP.md)
3. [Document and scene model](DOCUMENT_AND_SCENE_MODEL.md)
4. [Rendering and processing](RENDERING_AND_PROCESSING.md)
5. [Vector system](VECTOR_SYSTEM.md)
6. [Performance contract](PERFORMANCE_CONTRACT.md)
7. [Hosts, I/O and portability](HOSTS_IO_AND_PORTABILITY.md)
8. [Photoshop interchange](PHOTOSHOP_INTERCHANGE.md)
9. [Photoshop parity and missing features](PHOTOSHOP_PARITY_AND_MISSING_FEATURES.md)
10. [PSD/PSB export scope](PSD_PSB_EXPORT_SCOPE.md)
11. [PDF open and export audit](PDF_OPEN_AND_EXPORT_AUDIT.md)
12. [Product UX inspiration and capability gaps](PRODUCT_UX_INSPIRATION_AND_GAPS.md)
13. [Input, tools and history](INPUT_TOOLS_AND_HISTORY.md)
14. [UI, workspace and design system](UI_WORKSPACE_AND_DESIGN_SYSTEM.md)
15. [Reliability and verification](RELIABILITY_AND_VERIFICATION.md)
16. [Repeatable complete-app quality gate](COMPLETE_APP_QUALITY_GATE.md)
17. [Current state and roadmap](CURRENT_STATE_AND_ROADMAP.md)
18. [Change rules](CHANGE_RULES.md)

## Directory roles

- `contracts/`: narrow invariants shared by multiple systems.
- `features/`: active feature-level architecture and specifications.
- `integrations/`: host-adapter contracts and verification plans.
- `ui/`: visual direction for the shared LightTable UI.
- `ux/`: detailed interaction specifications.
- `reference/`: useful research and implementation records.
- `obsolete/`: superseded material kept only for historical context.

## Shared vocabulary

- **Document space**: stable, unbounded authoring coordinates. The canvas
  rectangle clips the final document result; it does not limit pointer input.
- **Layer-local space**: coordinates owned by a layer before its scene
  transform is applied.
- **Viewport space**: pan and zoom presentation only. Never serialized into
  document geometry.
- **Processing node**: serializable, ordered image operation with an explicit
  owner, scope, domain and executor.
- **Grade**: tone/color/detail processing. It may be attached to a compatible
  layer or live in an adjustment layer.
- **Lens Fx**: spatial/lens/output processing using the same ownership model as
  Grade; it is not hidden global state.
- **Flatten/rasterize**: evaluate pixels and reset the resulting raster's
  transform to identity with newly measured bounds.
- **Dirty-only rendering**: only stages invalidated by a semantic change may
  execute. A UI update is not automatically an image recomposition.

## Updating this context

Change these contracts in the same milestone as an architectural change. Mark
claims as **current**, **partial**, or **target**. Never describe a target as if
it already works, and do not preserve obsolete alpha-format branches merely to
make old LightTable files load.
