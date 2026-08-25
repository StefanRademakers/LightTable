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

## Onboarding route

After a fresh session or context collapse, start with
[AI coding-agent onboarding](AGENT_ONBOARDING.md) and run
`npm run context:agent`. It separates live repository state from durable
architecture and routes each change to a small contract set.

Then use [Architecture quickstart](QUICKSTART.md) for the product and system
model and [Current state and roadmap](CURRENT_STATE_AND_ROADMAP.md) for the
current/partial/target boundary. Do not read the catalog below linearly unless
the task genuinely spans every system.

## Contract catalog

- [Product and principles](PRODUCT_AND_PRINCIPLES.md)
- [Long-term product goals](goals/README.md)
- [Agent-native creative runtime target](goals/AGENT_NATIVE_CREATIVE_RUNTIME_TARGET.md)
- [Product, market and engineering assessment](LIGHTTABLE_PRODUCT_AND_MARKET_ASSESSMENT_2026-08-06.md)
- [System map](SYSTEM_MAP.md)
- [Document and scene model](DOCUMENT_AND_SCENE_MODEL.md)
- [Rendering and processing](RENDERING_AND_PROCESSING.md)
- [Visual parity engineering](VISUAL_PARITY_ENGINEERING.md)
- [Detail, sharpening and denoise research](DETAIL_DENOISE_RESEARCH.md)
- [Vector system](VECTOR_SYSTEM.md)
- [Performance contract](PERFORMANCE_CONTRACT.md)
- [Supported hardware and release soak](SUPPORTED_HARDWARE_AND_SOAK_GATE.md)
- [Hosts, I/O and portability](HOSTS_IO_AND_PORTABILITY.md)
- [Photoshop interchange](PHOTOSHOP_INTERCHANGE.md)
- [Photoshop parity and missing features](PHOTOSHOP_PARITY_AND_MISSING_FEATURES.md)
- [PSD/PSB export scope](PSD_PSB_EXPORT_SCOPE.md)
- [Photoshop layer-effects roundtrip corpus](PSD_LAYER_EFFECTS_ROUNDTRIP_CORPUS.md)
- [PSD visual side-by-side review](PSD_VISUAL_SIDE_BY_SIDE.md)
- [Photoshop blend-mode color profile corpus](PSD_BLEND_MODE_COLOR_PROFILE_CORPUS.md)
- [Photoshop color and blend parity](PHOTOSHOP_COLOR_AND_BLEND_PARITY.md)
- [Photoshop adjustment layers: UX, reuse and parity plan](PHOTOSHOP_ADJUSTMENT_LAYERS.md)
- [PDF open and export audit](PDF_OPEN_AND_EXPORT_AUDIT.md)
- [Layered interchange release matrix](LAYERED_INTERCHANGE_RELEASE_MATRIX.md)
- [Missing-font recovery](features/MISSING_FONT_RECOVERY.md)
- [Unsupported-feature recovery](features/UNSUPPORTED_FEATURE_RECOVERY.md)
- [Vector shape and gradient authoring](features/VECTOR_SHAPE_AND_GRADIENT_AUTHORING.md)
- [Vector engine and SVG import capability](features/VECTOR_ENGINE_AND_SVG_IMPORT.md)
- [Selection, mask and paint workflow](features/SELECTION_MASK_AND_PAINT_WORKFLOW.md)
- [P0 GPU filters](features/P0_GPU_FILTERS.md)
- [Document image palette](features/DOCUMENT_IMAGE_PALETTE.md)
- [Resources, workspaces and recent documents](features/RESOURCES_WORKSPACES_AND_RECENTS.md)
- [Project-mode feature gating](features/PROJECT_MODE_FEATURE_GATING.md)
- [Multi-document types and video](features/MULTI_DOCUMENT_TYPES_AND_VIDEO.md)
- [First-run onboarding](features/FIRST_RUN_ONBOARDING.md)
- [Product UX inspiration and capability gaps](PRODUCT_UX_INSPIRATION_AND_GAPS.md)
- [Input, tools and history](INPUT_TOOLS_AND_HISTORY.md)
- [UI, workspace and design system](UI_WORKSPACE_AND_DESIGN_SYSTEM.md)
- [Build and distribution](contracts/BUILD_AND_DISTRIBUTION.md)
- [Accessibility, keyboard and focus](ACCESSIBILITY_KEYBOARD_AND_FOCUS.md)
- [Reliability and verification](RELIABILITY_AND_VERIFICATION.md)
- [Privacy and support diagnostics](PRIVACY_AND_SUPPORT_DIAGNOSTICS.md)
- [Repeatable complete-app quality gate](COMPLETE_APP_QUALITY_GATE.md)
- [Repeatable quality and parity tests](tests/README.md)
- [Current code quality and latency audit](CODE_QUALITY_AUDIT_2026-08-06.md)
- [Embedded desktop Agent Access](integrations/EMBEDDED_AGENT_ACCESS.md)
- [Outbound Agent server pairing](integrations/OUTBOUND_AGENT_PAIRING.md)
- [LightTable MCP v1 integration](integrations/LIGHTTABLE_MCP_V1.md)
- [Local Codex to LightTable MCP acceptance](integrations/LOCAL_CODEX_MCP_ACCEPTANCE.md)
- [Architecture documentation audit and handoff](ARCHITECTURE_DOCUMENTATION_AUDIT_2026-08-06.md)
- [Change rules](CHANGE_RULES.md)

## Directory roles

- `goals/`: canonical multi-milestone product outcomes; not current-state
  claims or executable task queues.
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
- **Render island**: a disposable retained render projection over one or more
  independently editable canonical vector layers, split only at observable
  compositor boundaries. It is never a layer merge or document authority.
- **First useful pixel**: the first verified non-blank presented document
  image after queue completion and a browser paint opportunity. It is not
  automatically final editable readiness; a renderer-only SVG preview must
  later be replaced by the canonical retained result.

## Updating this context

Change these contracts in the same milestone as an architectural change. Mark
claims as **current**, **partial**, or **target**. Never describe a target as if
it already works, and do not preserve obsolete alpha-format branches merely to
make old LightTable files load.

Run `npm run audit:architecture-docs` after documentation changes. It validates
local links, current workspace topology, generated dependency counts and the
large-source references used by the architecture handoff.
