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
2. [Current state and roadmap](CURRENT_STATE_AND_ROADMAP.md)
3. [Product, market and engineering assessment](LIGHTTABLE_PRODUCT_AND_MARKET_ASSESSMENT_2026-08-06.md)
4. [System map](SYSTEM_MAP.md)
5. [Document and scene model](DOCUMENT_AND_SCENE_MODEL.md)
6. [Rendering and processing](RENDERING_AND_PROCESSING.md)
7. [Vector system](VECTOR_SYSTEM.md)
8. [Performance contract](PERFORMANCE_CONTRACT.md)
9. [Supported hardware and release soak](SUPPORTED_HARDWARE_AND_SOAK_GATE.md)
10. [Hosts, I/O and portability](HOSTS_IO_AND_PORTABILITY.md)
11. [Photoshop interchange](PHOTOSHOP_INTERCHANGE.md)
12. [Photoshop parity and missing features](PHOTOSHOP_PARITY_AND_MISSING_FEATURES.md)
13. [PSD/PSB export scope](PSD_PSB_EXPORT_SCOPE.md)
14. [Photoshop layer-effects roundtrip corpus](PSD_LAYER_EFFECTS_ROUNDTRIP_CORPUS.md)
15. [PSD visual side-by-side review](PSD_VISUAL_SIDE_BY_SIDE.md)
16. [Photoshop blend-mode color profile corpus](PSD_BLEND_MODE_COLOR_PROFILE_CORPUS.md)
17. [Photoshop color and blend parity](PHOTOSHOP_COLOR_AND_BLEND_PARITY.md)
18. [PDF open and export audit](PDF_OPEN_AND_EXPORT_AUDIT.md)
19. [Layered interchange release matrix](LAYERED_INTERCHANGE_RELEASE_MATRIX.md)
20. [Missing-font recovery](features/MISSING_FONT_RECOVERY.md)
21. [Unsupported-feature recovery](features/UNSUPPORTED_FEATURE_RECOVERY.md)
22. [Vector shape and gradient authoring](features/VECTOR_SHAPE_AND_GRADIENT_AUTHORING.md)
23. [Selection, mask and paint workflow](features/SELECTION_MASK_AND_PAINT_WORKFLOW.md)
24. [Resources, workspaces and recent documents](features/RESOURCES_WORKSPACES_AND_RECENTS.md)
25. [First-run onboarding](features/FIRST_RUN_ONBOARDING.md)
26. [Product UX inspiration and capability gaps](PRODUCT_UX_INSPIRATION_AND_GAPS.md)
27. [Input, tools and history](INPUT_TOOLS_AND_HISTORY.md)
28. [UI, workspace and design system](UI_WORKSPACE_AND_DESIGN_SYSTEM.md)
29. [Accessibility, keyboard and focus](ACCESSIBILITY_KEYBOARD_AND_FOCUS.md)
30. [Reliability and verification](RELIABILITY_AND_VERIFICATION.md)
31. [Privacy and support diagnostics](PRIVACY_AND_SUPPORT_DIAGNOSTICS.md)
32. [Repeatable complete-app quality gate](COMPLETE_APP_QUALITY_GATE.md)
33. [Repeatable quality and parity tests](tests/README.md)
34. [Current code quality and latency audit](CODE_QUALITY_AUDIT_2026-08-06.md)
35. [Embedded desktop Agent Access](integrations/EMBEDDED_AGENT_ACCESS.md)
36. [Outbound Agent server pairing](integrations/OUTBOUND_AGENT_PAIRING.md)
37. [LightTable MCP v1 integration](integrations/LIGHTTABLE_MCP_V1.md)
38. [Architecture documentation audit and handoff](ARCHITECTURE_DOCUMENTATION_AUDIT_2026-08-06.md)
39. [Change rules](CHANGE_RULES.md)

## Directory roles

- `contracts/`: narrow invariants shared by multiple systems.
- `features/`: active feature-level architecture and specifications.
- `integrations/`: host-adapter contracts and verification plans.
- `tests/`: stable test entry points, oracle ownership and gate interpretation.
- `ui/`: visual direction for the shared LightTable UI.
- `ux/`: detailed interaction specifications.
- `reference/`: useful research and implementation records.
- `research/`: owner-supplied active research inputs; reconcile conclusions
  into canonical contracts before implementing them.
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

Run `npm run audit:architecture-docs` after documentation changes. It validates
local links, current workspace topology, generated dependency counts and the
large-source references used by the architecture handoff.
