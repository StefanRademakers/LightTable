# Filter vertical slice

Status: **S10 common ownership/transaction route accepted by automated gates; locked-owner UX P2 open**.

Baseline: `8bf4357d` (`stabilize layer style transaction lifecycle`).

## Scope and tiering

S10 has one ownership/lifecycle route and three independently accepted visual
tiers. The common route must be built once; P1/P2 may not fork their own
transaction, history, command or resource policy.

- P0: 12 release-critical full-frame filters;
- P1: 18 secondary filters;
- P2: 26 extended/stylization filters.

Standalone filter layers and attached raster-processing nodes are the two
supported placements. A filter node is not a generic Grade/Adjustment snapshot
and Layer Styles remain a separate alpha-derived compositor stage.

## Current authority map

| Concern | Current owner | Required owner |
| --- | --- | --- |
| kind/settings/module identity | filter `AdjustmentStack` on an adjustment layer or attached owner | unchanged canonical document owner |
| definitions/defaults/controls/bounds | `@lighttable/filter-core` P0/P1/P2 catalogs | one shared strict serializable domain |
| Properties interaction | misnamed `useP0FilterController` for all tiers | small tier-neutral application session |
| pointer preview | `DocumentMutationController` staged document projection | document/target/renderer-generation-bound disposable projection |
| local history | `DocumentMutationController` | one terminal checkpoint or none |
| Actions/MCP | creation only through `adjustment.create`; edits have no exact semantic command | one complete typed filter snapshot command |
| rendering | `P0FilterRenderer` also dispatches P1/P2 executors | tier-neutral renderer facade with algorithms in filter packages |
| image-sized scratch | one lazy three-target `FilterTargetPool` | unchanged document-renderer resource owner |
| keyed GPU runtime | individual cores plus `releaseInactive` | revision/owner keyed, bounded and totally disposed |

## Opening findings

1. The current controller already stages pointer previews and creates one
   history item, but its transaction identity omits filter kind and renderer
   generation. Replacement can therefore inherit or project through a newer
   renderer/owner without an explicit terminal decision.
2. Reset/toggle and slider completion have no one exact Action/MCP edit command;
   only creation is externally reproducible.
3. Runtime catalogs normalize/clamp unknown input. That is appropriate for UI
   adaptation but insufficient as an external exact codec: missing, extra,
   non-canonical and non-finite values must fail before mutation.
4. Locked filter owners now fail closed; a disabled/read-only presentation
   remains a tracked P2 UX item.
5. The obsolete Gaussian-specific controller, panel and renderer alias were
   removed instead of retained as an importable parallel path.
6. `P0FilterRenderer` is also the all-tier facade. The name is misleading but
   the shared target-pool/resource topology is correct and must not be replaced
   with per-filter full-frame allocations.

## Target route

```text
Properties control
  -> exact document + placement + layer/attached id + kind + renderer generation
  -> staged renderer document preview (newest current generation only)
  -> one strict complete FilterSnapshot terminal checkpoint
  -> canonical document publication + one history entry
  -> one filter.setSnapshot Action observation

Action / MCP filter.setSnapshot
  -> the same strict snapshot codec and owner resolver
  -> the same canonical document mutation authority
```

`FilterSnapshot` contains exactly `kind`, `enabled` and the complete normalized
settings object for that kind. Revision, UI state, pointer samples, GPU handles
and renderer/cache identities never cross the command boundary.

## Performance and resource invariants

- no pointer-rate React or canonical document publication;
- no GPU readback in preview/commit;
- no new image-sized allocation after the shared pool is warm;
- Displace refers only to a same-document canonical raster layer id;
- removing, flattening, rasterizing or merging away that raster clears the
  reference in the same document command;
- stale document/target/kind/renderer generations cannot commit;
- cancel, lock, target switch, document switch, renderer rebind, failure and
  unmount discard the preview and create no history/Action entry;
- one accepted gesture produces exactly one history and one Action entry;
- removal/document close releases all keyed runtime; the document renderer
  owns and destroys the shared pool.

## Acceptance plan

- [x] current owner/resource/command mapping;
- [x] packaged P0 creation/render/delete baseline at 1280x720;
- [x] strict complete snapshot codec and semantic executor;
- [x] tier-neutral document/target/kind/renderer-bound interaction session;
- [x] unique disposable preview generations and one terminal canonical revision;
- [x] exact cancel/commit/undo/redo/Action/MCP parity in focused tests;
- [ ] disabled/read-only locked-owner Properties UI (P2);
- [ ] standalone plus attached, masks, reorder, save/open, rasterize and merge;
- [x] independent critic and two repair loops;
- [x] packaged 56-filter render/delete/cleanup and warm-resource gate;
- [ ] packaged P0 Properties drag interaction and owner acceptance;
- [x] packaged P1 render/delete/cleanup matrix; owner acceptance remains open;
- [x] packaged P2 render/delete/cleanup matrix; owner acceptance remains open.

## Acceptance evidence

- app typecheck passed;
- 571 app test files / 3,629 tests passed;
- 34 command-contract tests and the architecture boundary passed;
- instrumented desktop package passed distribution and telemetry boundaries;
- packaged 1280x720 smoke rendered all 56 filters, reproduced the same export
  per filter after cleanup/recreation, reported no page/console errors and held
  the warm peak at 89,411,584 estimated GPU bytes;
- the independent critic completed two repair loops and found no remaining
  P0/P1 in the common route. The disabled locked-owner presentation is the one
  explicit deferred P2.

The source-structure audit is already red on the shared renderer/overlay
hotspots. S10 may extract filter orchestration, but must not move algorithms
into the overlay or inflate a replacement monster controller.
