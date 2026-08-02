# LightTable documentation map

Updated: 2026-07-31

The code and its tests are authoritative. File dates help identify older
assumptions, but age alone does not make research invalid. This index says
which documents direct current work and which ones are retained as reference.

## Read first

1. `CURRENT_REFACTOR_HANDOFF.md` — short operational checkpoint.
2. `LIGHTTABLE_PRODUCTION_MODULARIZATION_PLAN.md` — active architecture and
   migration tracker.
3. `lighttable_product_roadmap.md` — current product-level order of work.
4. `../LIGHTTABLE_GPU_WARP_TOOL_SPEC.md` — active Warp product and engine
   specification.

The immediate sequence is deliberate: finish the production decomposition,
then complete Warp on those boundaries. UI polish performed between these
milestones does not replace that direction.

## Authoritative contracts

| Document | Authority |
| --- | --- |
| `coordinate_contract.md` | Raster, mask, selection, transform and pointer coordinate spaces. |
| `canvas_bounds_and_unbounded_editor_space.md` | Finite pixel canvas inside an unbounded editor workspace. |
| `LIGHTTABLE_EXPLICIT_PROCESSING_OWNERSHIP.md` | Where Grade, Lens Fx and output processing live. |
| `LIGHTTABLE_LAYER_SCOPE_AND_PSD_MAPPING.md` | Mapping between LightTable processing scopes and Photoshop semantics. |
| `workspace_layout.md` | Workspace/document ownership and docking contract. |
| `../HOST_ARCHITECTURE.md` | Web, Electron and StoryBuilder host boundary. |

When an older proposal disagrees with one of these contracts, follow the
contract and current code.

## Active feature tracks

### PSD and Photoshop interoperability

- `PSD_FEATURE_PARITY_IMPLEMENTATION_PLAN.md` is the parity tracker.
- `PSD_PARITY_TESTABLE_IMPORT_PATH.md` defines the test-first import gates.
- `AG_PSD_FEATURE_PARITY_REFERENCE.md` is format/library research.
- `LAYER_STYLES_IMPLEMENTATION_TRACKER.md` and
  `LAYER_STYLES_SUPPORT_REPORT.md` track Layer Style work.
- Images in `styles/` are visual references, not implementation truth.

### Image I/O

- `lighttable_wasm_vips_implementation_checklist.md` is the active checklist.
- `archive/lighttable-wasm-vips-spike-and-implementation-plan.md` is the original
  research spike and is retained for rationale only.

### Transform and alignment

- `transform_tool.md` documents the current transform contract and remaining
  interaction validation.
- `auto_align_v2_implementation_plan.md` is the newest Auto Align feature
  checkpoint.
- `archive/AUTO_ALIGN_FOLLOWUP_HANDOFF.md`,
  `archive/auto_align_audit_and_production_plan.md`,
  `archive/LIGHTTABLE_WEBGPU_AUTO_ALIGN_LAYERS.md`,
  `photoshop_auto_align_research.md` and
  `open_source_alignment_research.md` are historical design/research inputs.
  They are not the current application architecture plan.

### Deferred product research

- `lighttable_3d_layer_research_implementation_plan.md`
- `LIGHTTABLE_PERSPECTIVE_WORKSPACE_RESEARCH_AND_IMPLEMENTATION_PLAN.md`

These remain valuable future directions. They must enter through the current
document, command, processing-node, renderer and host boundaries rather than
creating parallel systems.

## Superseded architecture proposals

`archive/LIGHTTABLE_PER_LAYER_ADJUSTMENTS_AND_FUTURE_NODE_GRAPH.md` contains useful
design reasoning, but its description of a single document-wide pipeline and
StoryBuilder-local implementation predates the standalone repository,
multi-document sessions, explicit processing ownership and registered node
runtime. Use it as research only. Current decisions live in:

- `LIGHTTABLE_EXPLICIT_PROCESSING_OWNERSHIP.md`;
- `LIGHTTABLE_PRODUCTION_MODULARIZATION_PLAN.md`;
- `processing/moduleDefinitions.ts` and `processing/processingNodeRuntime.ts`;
- `effects/documentEffectNodeRegistry.ts`.

## Historical implementation notes

Files under `implemented/` are snapshots of completed milestones and effect
research. They explain why code exists but do not define the current complete
pipeline. In particular, old operation-order notes must not override the
registered processing plan or current renderer tests.

Files under `archive/` are obsolete or replaced plans and handoffs. They retain
decisions, experiments and acceptance criteria that may still be useful, but
they never override root-level contracts, active trackers, current code or
tests.

## Backlog policy

`lighttable_product_backlog.md` stores capabilities that must not disappear.
It is not an execution order. Before implementing an old unchecked item,
verify that it is still absent in code and has not been superseded by the
modularization plan or PSD tracker.

## Documentation maintenance rules

- Update the handoff after an architecture milestone or before pausing work.
- Check progress in exactly one owning tracker; link from other documents.
- Label research, active plans, contracts and historical snapshots explicitly.
- Never mark behavior implemented solely because a model or UI exists; require
  the relevant tests and dual-host smoke gate.
- Preserve useful research. Replace stale authority claims instead of deleting
  knowledge.
- Keep web and Electron requirements together unless a host capability is
  intentionally different.
