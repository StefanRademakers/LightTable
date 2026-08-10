# Final integrated product audit - 7 August 2026

Historical status (10 August 2026): this audit covers candidate `2643a94c`.
Subsequent product changes invalidate it as a final assessment of the current
build; its procedures remain reusable for a fresh audit.

Status: the complete automatable post-backlog audit passed. The product is a
**bounded technical preview**. Paid release remains blocked by four human,
physical-hardware, external-beta and production-operations gates.

## Assessed build

- Product-code commit: `2643a94cdaa994e868a5a2e91c0afed9d6b85c57`.
- Version: `0.1.0-alpha.1`.
- Source: clean detached checkout and deterministic dependency installation.
- Final signed evidence: `tmp/release-candidate/task-112-2643a94c-final3/`.
- Exact-candidate soak evidence:
  `tmp/release-candidate/task-113-2643a94c-packaged-two-hour-soak/`.
- Test-infrastructure commits after the product candidate: `bff744a5` and
  `51b59d13`; neither changes product runtime behavior.

User-owned icon, font and research changes in the primary worktree were not
hidden, staged or copied into the detached candidate.

## Requirement-by-requirement result

| Audit area | Evidence | Disposition |
| --- | --- | --- |
| Boundaries, architecture, tests, typechecks, web/desktop builds | final full profile, 40/40 | passed |
| Packaged end-to-end workflows | owner manifest, 15/15 and 0 defects | passed; owner feel review pending |
| Native save/recovery and PSD/PDF interchange | full profile plus acceptance | passed for declared routes |
| Text, vectors, gradients, paint, masks, transforms and Layer Styles | packaged smokes and command projections | passed for declared routes |
| Photoshop effects and blend/profile parity | current 40-case and 48-case gates | passed at current thresholds |
| MCP editable-design transaction and roundtrip | packaged MCP acceptance project | passed |
| Long-duration crash/leak/background-work audit | 70/70 two-hour cycles | passed on measured cell |
| Hardware support floor | signed Windows/discrete probe only | partial; other physical cells open |
| External beta evidence | zero-participant readiness audit | open |
| Production commercial lifecycle | fail-closed staging rehearsal | technical pass; policy/providers open |

No supported-route runtime stop, page error, WebGPU validation failure,
semantic roundtrip failure, fidelity-gate failure, suspicious stable memory/GPU
tail or orphan process remained in the final automated evidence.

## Performance and endurance

The exact packaged candidate ran 7,298,230 ms across 70 complete cycles and
350 representative document opens. It produced zero failed cycles, zero
invalid screenshots, zero suspicious stable tails, zero settled background
submissions and zero orphan processes.

Text input-to-submit measured 36.1 ms median / 56.8 ms p95; input-to-GPU was
61.2 ms median / 75.5 ms p95. First useful frame was 941 ms median / 2,356 ms
p95 across PNG, text PSD, shapes PSD, PDF and EHS-396. These are honest
measurements, not universal performance claims: the host was Windows 11,
RTX 5090, DPR 1, packaged Electron.

## Repairs made during final audit

- classified bounded lazy GPU realization separately from continuing leaks;
- removed a selection-overlay initialization race from canvas auditing;
- added bounded recovery for transient pre-document packaged navigation;
- bound recovery and all owner workflows to the exact packaged candidate;
- migrated seven legacy smokes away from silent development-Electron launch;
- bound soak acceptance to exact clean commit, duration, all-green cycles and
  zero orphan processes;
- made signed evidence cover the exact persisted report bytes, with fail-closed
  regression tests.

Thresholds were not relaxed. Product, import, render, semantic and fidelity
failures are not hidden behind startup retries.

## Capability disposition

- **Verified for the bounded candidate:** declared open/create/edit/undo,
  native save/recovery, common PSD roundtrip, PDF open/export, common text and
  vector authoring, gradients, paint/masks, transforms, common Layer Styles,
  diagnostics, accessibility smoke and one semantic MCP design roundtrip.
- **Partial or preserved:** uncommon PSD semantics, advanced text-on-path and
  vector stroke behavior, Smart Object authoring, broad semantic PDF editing,
  exact extreme-radius effect fidelity and some missing-font substitutions.
- **Deferred:** broader adjustment-layer parity beyond Grade, deep painting,
  plugin ecosystem, broad remote AI and additional product categories.
- **Unsupported claims:** complete Photoshop/PDF parity, a qualified integrated
  GPU or Apple Silicon floor, external-beta product validation and production
  activation/update readiness.

## Remaining blockers and ownership

- Task 108: explicit product-owner acceptance and signed visual/interaction
  judgment.
- Task 109: physical Windows integrated/web and Apple Silicon Electron/web
  matrix, display scales and supported hardware floor.
- Task 110: consented design-partner cohort, aggregate results and exit review.
- Task 111: commercial/legal decisions, activation receipts and production
  installer/update/rollback providers.

Tasks 112 and 113 stay open because their declared completion depends on those
four gates. The automatable engineering work and reassessment are complete;
automation cannot truthfully manufacture the remaining evidence.

## Final decision

Automated no-go defects: none on product candidate `2643a94c`.

Release classification: **bounded technical preview** on the measured Windows
discrete-GPU Electron cell. **No paid release** until Tasks 108-111 provide the
missing human, hardware, beta and production evidence and the owner signs the
final go/no-go record.
