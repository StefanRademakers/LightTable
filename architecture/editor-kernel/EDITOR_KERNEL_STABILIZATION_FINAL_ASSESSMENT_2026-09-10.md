# Editor kernel stabilization: final technical assessment

Date: 2026-09-10

Comparison baseline: `LIGHTTABLE_WHOLE_PRODUCT_ARCHITECTURE_SALVAGE_AUDIT_2026-09-06.md` at `cce15c7c`

Assessment scope: the complete S00--S13 stabilization ledger and the current packaged Windows build

Status: engineering stabilization complete; final owner interaction acceptance and broader release qualification remain open

## Verdict

The decision to rescue LightTable through a new, document-scoped kernel and a
vertical-slice migration was the right decision. The September 6 audit's main
claim was that LightTable had useful specialist engines but an unreliable
integration core with several independently publishing authorities. The current
implementation no longer relies on one broad rewrite or on tests around isolated
functions: each migrated artist operation now has a named admission, preview,
commit/cancel, history, renderer/resource and cleanup route.

That is enough evidence to reject the earlier **fail-state** diagnosis for the
architecture. It is not enough to call LightTable finished, bug-free,
Photoshop-compatible or commercially releasable. All tool/processing slices are
at the owner gate, not beyond it. The correct next decision is a focused manual
acceptance run on this exact build; feature development stays frozen until that
run succeeds.

## What changed at system level

The runtime now consistently targets this shape:

```text
UI / shortcut / Action / MCP
             |
      semantic command + capability
             v
 document-bound kernel transaction/session
       |                         |
canonical document/history   projection/resource ports
       |                         |
serializable committed state  retained WebGPU/UI realization
```

Across selections and paint, layer finalization, masks/background removal,
transform/snapping, vector, text/path text, warp, adjustments, effects, filters,
document geometry and I/O, and view/multi-document lifecycle, the migration did
four important things:

1. It made one semantic operation, rather than a mounted React component, the
   unit of command execution and history.
2. It bound asynchronous work to the admitted document, renderer generation,
   source revision and resource lease, so a later tab/tool state cannot receive
   an older result.
3. It separated disposable preview/presentation state from one terminal
   canonical publication and one undo unit.
4. It made failure and cleanup explicit, including rollback, stale completion,
   device loss, renderer retirement and document close.

React remains UI and low-frequency projection. WebGPU remains the high-volume
renderer. The change did not move pointer-frequency pixels into React or clone
the full GPU document into ordinary component state.

## Comparison with the salvage audit

| September 6 finding | Earlier risk | Current state | Remaining risk |
| --- | --- | --- | --- |
| Model and GPU resources could diverge | High likelihood, critical impact | Pixel/mask mutations use resource leases, terminal coordinators and resource-aware rollback; device-loss policy is explicit | Raster resources are not all reconstructable, so true loss deliberately requires a checkpoint |
| Execution changed with presentation state | High | Migrated UI, shortcuts, Actions and MCP enter shared semantic handlers; a packaged bounded workflow produces equivalent states and errors | The parity proof is broad but sampled, not a mathematical proof of every parameter combination |
| Transactions were caller convention | Medium-high, critical impact | Kernel sessions own admission, preview, one commit/cancel and durable compensation; failed commands are covered per slice | Existing compatibility fallbacks remain quarantined until owner acceptance |
| History closures could miss GPU/editor state | High | Slice matrices cover exact resource/state restore; the final route matrix unwinds and replays ten mixed operations through UI, Actions and MCP | The original audit's 100-cycle release gate has not been used as a commercial certification claim |
| Device/renderer loss could lose state | Medium, critical impact | Reconstructable SVG recovers pixel-identically; raster loss fails closed without changing canonical layers/revision | Automatic raster recovery requires a future durable pixel backing store/checkpoint strategy |
| GPU retention was opaque | Medium-high | Resource accounting, background telemetry, close/reopen proof and multi-document stable-tail checks are active | Twelve-hour and multi-hardware qualification remain open |
| Tool lifecycle differed per controller | High combinatorial risk | S00--S10 define the same lifecycle vocabulary and route per domain | Some large input/composition adapters still need responsibility extraction when next touched |
| Integration roots kept growing | High maintainability risk | Named owners moved into small kernel/application modules and no-growth rules are documented | `LightTableEditorOverlay.tsx` and `WebGpuEngine.ts` are still large legacy facades, not solved files |
| Registries were descriptive and duplicated | Medium | Capability and semantic command ownership is shared for migrated routes | Full generative tool/command/catalog registration remains architectural debt |

## Final evidence

### Command and history equivalence

The packaged route-equivalence workflow creates ten mixed operations covering
shape creation/editing, transform, rename, text creation/editing and rasterize.
UI, recorded Actions and external MCP each unwind to the exact opening state and
redo to the exact final state. Validation and stale-target failures leave state
and history unchanged. History change detection is based on the history state
identity, not a coincidentally changing internal document revision.

Evidence: `tmp/route-equivalence-smoke/evidence.json`.

### Device loss, allocation and close

- Reconstructable SVG: forced device destruction, automatic renderer rebuild,
  identical SHA-256 preview, stable layers/revision and active Vello rendering.
- Raster PNG: forced device destruction, stable layers/revision, zero retained
  renderer bytes and an explicit checkpoint-required failure instead of an
  empty or misleading canvas.
- Async WebGPU error scopes: one 72-line shared per-device transaction is used
  by app and text GPU clients; partial scope/allocation failure cannot run the
  operation or strand the lock.
- Open overlap: a canceled hydrate remains unsettled until its promise ends;
  failed replacement clears the external renderer slot and destroys the old
  renderer exactly once.
- Packaged close/reopen: exact pixel and presentation ownership retention passed.

Evidence: `tmp/final-system-matrix/device-loss-vector-clean/report.json`,
`tmp/final-system-matrix/device-loss-raster-clean/report.json` and
`tmp/document-pixel-retention-smoke/report.json`.

The independent architecture critic completed two repair rounds and returned
PASS with no remaining P0/P1.

### Performance and soak

The final release-CI run passed all seven stages:

- a six-iteration matrix over PNG, text PSD, shape PSD, PDF and a large PSD;
- canvas, marquee/selection and transform interaction;
- Type editing;
- Layer Style interaction;
- native save and export;
- PSD roundtrip;
- bounded, local-only support diagnostics.

It recorded zero background frame submissions, zero orphan processes, maximum
stable-tail heap growth of 76,420 bytes and maximum measured GPU growth of 960
bytes across the sampled documents. The Type input-to-GPU p95 was 41.1 ms in
this instrumented packaged run. No suspicious JS, DOM, listener or GPU growth
was reported.

Evidence: `tmp/final-system-matrix/release-soak-ci-clean/report.json` and
`tmp/final-system-matrix/multi-document-soak-final3.json`.

These are healthy bounded results, not an overnight claim. The report explicitly
marks twelve-hour extrapolation as `not-measured`.

### Repository gates

The final source state passes boundary verification, source-structure audit,
all workspace typechecks/tests, the production web build and the instrumented
packaged desktop build. The two stale automation selectors exposed by the broad
soak were updated to current stable UI contracts, then the complete soak passed.

## Did the architecture choice preserve performance?

Yes, in architectural shape and in the bounded measurements. The kernel stores
semantic state and lifecycle rules; it does not render pixels. Interactive
previews remain retained renderer operations, document composition invalidates
by domain, and unchanged background documents submit no frames. The shared GPU
scope coordinator runs only around exceptional initialization/validation work,
not per pointer event or per ordinary frame.

The honest limit is that one RTX 5090 Windows machine and an instrumented build
do not establish all supported-hardware budgets. Integrated-GPU, Apple Silicon,
very long session and truly huge layered-document qualification still belong to
release engineering.

## What is still open

1. The owner must manually exercise the exact packaged build for interaction
   feel, especially selection contours, paint, snapping, text/path text, warp,
   effects and repeated undo/redo. Automated acceptance cannot judge feel.
2. Legacy fallbacks deliberately remain quarantined in slices whose owner gate
   is open. They may be removed only after acceptance; they are not extension
   points.
3. The large overlay and renderer facade remain maintainability risks. Continue
   extracting one named authority per touched slice; do not start a mechanical
   file-splitting campaign.
4. Automatic raster device-loss recovery is not claimed. A future durable
   pixel-resource store or checkpoint lane is required for that capability.
5. Commercial release gates—overnight/multi-device soak, installer/signing,
   security/privacy/legal, accessibility and external beta evidence—are outside
   this stabilization proof.

## Decision

Continue with this kernel architecture. Do not rebuild LightTable from scratch,
and do not resume broad feature work yet. First perform the owner acceptance
pass and record every failure against the owning slice. If that pass confirms
the current behavior, remove the corresponding quarantined fallbacks in small
milestones and retain the same command/transaction/resource contracts.

The rescue has produced a substantially more coherent and testable editor core.
The remaining uncertainty is now product acceptance and release qualification,
not whether the integration architecture can be made internally consistent.
