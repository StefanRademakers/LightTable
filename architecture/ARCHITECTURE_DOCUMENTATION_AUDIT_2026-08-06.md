# Architecture documentation audit and agent handoff

Status: complete repository-wide documentation reconciliation, 6 August 2026.

## Scope and method

All 97 Markdown documents present under `architecture/` before this report was
written were inventoried and reviewed by role, current claims and relationship
to code/tests. This included canonical root contracts, feature/integration/test
documents, current risks, UX specifications, supporting reference/research and
the explicitly obsolete archive. The three owner-supplied untracked research
documents were read as inputs and deliberately not modified or staged.

The review checked current workspace/package topology, tool and command
boundaries, format routes, generated third-party inventory, source-size
ratchets, parity evidence, quality entry points and every relative Markdown
link. Code and tests remain authoritative when an implementation tracker or
historical plan disagrees.

## Classification

| Area | Documents reviewed | Authority |
| --- | ---: | --- |
| Canonical root contracts and current reports | 27 | Current, subject to each file's explicit status |
| `contracts/` | 1 | Narrow normative invariant |
| `features/` | 1 | Active feature specification; current/target sections must remain distinct |
| `integrations/` | 2 | Host/integration contract and test plan |
| `tests/` | 2 | Durable test entry points and oracle interpretation |
| `risks/` | 3 | Measured risk registers; dated results are baselines, not current guarantees |
| `ui/` and `ux/` | 6 | Interaction/design specifications; not implementation claims unless stated |
| `reference/` | 28 | Research, trackers and implementation evidence; non-canonical |
| `research/` | 2 | Owner-supplied active research inputs; non-canonical until reconciled |
| `obsolete/` | 25 | Historical only, regardless of old embedded “active” wording |

This report becomes document 98. `architecture/README.md` remains the canonical
reading route; new agents should not start in `reference/` or `obsolete/`.

## Corrections made

### Workspace topology

`SYSTEM_MAP.md` now lists all current applications and packages: desktop, web,
MCP server, shared application, paint, PDF, text/Wasm/rendering/WebGPU and
vector core/rendering/WebGPU. The dependency direction and authority model did
not change.

### Current capabilities

`CURRENT_STATE_AND_ROADMAP.md` now records the semantic text stack, PSD export
release candidate, strict effects/color corpora, bounded PDF route and MCP v1
slice. It continues to mark advanced text recovery, Smart Objects/Filters,
adjustments, patterns and broader export as partial rather than supported.

### Photoshop parity

`PHOTOSHOP_PARITY_AND_MISSING_FEATURES.md` no longer calls Vivid Light/Hard Mix
an open endpoint defect. The precise current claim is the measured 48-case
untagged/sRGB/Adobe RGB 8/16-bit set at RMSE 0.07–0.79. Other profile classes,
32-bit documents and unmeasured semantics remain outside that claim. The
priority list now starts after already-completed tight-raster, PSD RC and
blend/profile work.

### Generated dependency truth

`THIRD_PARTY_AND_FORMAT_SUPPORT.md` now agrees with the generated inventory:
713 npm package/version entries and 80 Cargo crates. It still requires actual
distributed notice review and does not turn transitive codecs into product
support.

### Verification evidence

`CODE_QUALITY_AUDIT_2026-08-06.md` now records the verified final quick-profile
count of 312 application test files / 1,665 tests. Dated performance and corpus
measurements were retained as dated evidence rather than rewritten as timeless
guarantees.

## Confirmed current architecture

The following decisions agree across code, tests and canonical documentation:

1. `ImageDocument` is canonical; GPU resources and previews are derived.
2. Scene transforms and unbounded layer-local content remain separate from the
   document canvas clip and viewport presentation.
3. One compositor owns layer evaluation; export, merge, thumbnails and scopes
   may not invent alternative document semantics.
4. Content, viewport, overlay and analysis have separate dirty/revision domains.
5. One gesture produces one semantic history command; preview state is
   disposable and pointer-frequency state does not belong in React.
6. Web and Electron share the editor. Desktop capabilities are ports, not
   alternate application behavior.
7. Text and vectors retain semantic sources; atlases, tessellation and bounded
   preview bitmaps are caches.
8. PSD/PDF are adapters. Unsupported source behavior must be reported,
   preserved or fail closed—never silently approximated as full support.
9. MCP and automation consume the application command service and cannot own a
   second model, renderer or history.
10. Performance and resource ownership are correctness requirements measured
    by production desktop gates.

## Important partial boundaries for the next agent

- The PSD release candidate is a verified 8-bit RGB subset, not complete
  PSD/PSB output. Pattern resources, Smart Object source embedding, arbitrary
  text-on-path creation, 16-bit write and representative PSB remain gated.
- PDF open is a preserved, rasterized first-page preview. PDF export is one
  page and uses a flattened fallback or a strictly compatible native suffix;
  it is not semantic multipage PDF editing.
- Text is real and editable for supported point/paragraph/vertical/imported
  path cases, but missing-font recovery and advanced Photoshop text behavior
  remain incomplete.
- Vector authoring is real, but compound/imported paths, full stroke
  alignment/joins/caps/paint and cross-feature fidelity need more coverage.
- Adjustments and Layer Styles use canonical descriptors/executors, but full
  Photoshop formula/stack parity is not claimed.
- The remote MCP transport is implemented; document/text/vector/gradient/style
  creation still needs semantic command-service slices before MCP exposure.
- `LightTableEditorOverlay.tsx` and `WebGpuEngine.ts` remain ratcheted
  integration facades. Continue cohesive extraction; do not rewrite them or
  move hot-path state into React.
- Autosave, crash recovery, updater/signing, accessibility and a supported
  hardware matrix remain commercial-release work.

## Documents intentionally not rewritten

Reference trackers and research plans retain historical measurements and
design alternatives. Their filenames and directory classify them as
non-authoritative. The `obsolete/` tree may contain old headings such as
“active production migration”; its directory-level README and the root
authority order override that historical wording. Rewriting those files would
erase useful provenance and create the false impression that old plans are
current tasks.

The detailed selection, paint/fill/eraser, vector, transform, warp, GPU-text,
PDF and future 3D/perspective specifications intentionally contain target
behavior beyond current implementation. They are design inputs, not parity
dashboards. Implementation truth stays in current status documents and tests.

## Automated guardrail

Run:

```powershell
npm run audit:architecture-docs
```

The gate discovers the current architecture tree and verifies:

- all relative Markdown links resolve;
- every large-source ratchet points to a real file within its documented cap;
- handwritten dependency counts match the generated inventory;
- `SYSTEM_MAP.md` contains every current app/package workspace.

It is part of the `quick` and `full` quality profiles. New architecture changes
must update code, the relevant canonical contract and this mechanically checked
handoff surface in the same cohesive change.

## Handoff reading rule

For ordinary work, read the root `README.md` sequence through Change Rules,
then only the feature/UX/reference documents relevant to the task. For a
performance, compatibility or release claim, run its named gate and record a
fresh result; do not promote a dated baseline or research target to “current.”
