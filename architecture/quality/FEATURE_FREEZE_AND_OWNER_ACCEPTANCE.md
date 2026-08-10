# Feature freeze and owner acceptance

Historical status: this freeze applied only to candidate `2643a94c`. Continued
feature development superseded that candidate, so the freeze is no longer
active. A future release freeze must identify a new exact commit and rerun this
acceptance programme.

During a newly declared release freeze, only measured P0/P1 release blockers, regression-test
infrastructure and release documentation may land. P2/P3 findings are recorded
and explicitly deferred; they do not become opportunistic feature work.

The canonical 15-project manifest is
`test/acceptance/owner-workflows.json`. It combines supplied PSD/PDF/photo
documents with clean-room projects and covers correction, layered design,
point/paragraph text, shapes, gradients, Layer Styles, paint/masks, transforms,
native save/recovery, PSD roundtrip, PDF, MCP and accessibility/diagnostics.
Every action is inside the document canvas except the explicitly named
off-canvas transform project.

Run the packaged program:

```powershell
npm run acceptance:owner -- --output tmp\owner-acceptance
```

The runner performs fixture preflight, executes the deterministic automation,
writes per-project logs, `report.json`, a deduplicated `defects.json` and a
recordable `owner-checklist.md`. It never edits or uploads source fixtures.
Screenshots and minimal generated artifacts remain beneath the run directory;
the source documents are opened read-only and saves use script-owned temporary
targets.

Automated success means **ready for owner review**, not product approval. The
owner must directly judge correctness, perceived latency, discoverability,
visual polish, undo trust, recovery confidence, export fidelity and disclosure
of preserved/raster fallbacks. The three sign-off boxes were not approved for
the historical candidate; a future candidate must generate a fresh checklist.

## Exact candidate handoff - 7 August 2026

The automated acceptance for product candidate
`2643a94cdaa994e868a5a2e91c0afed9d6b85c57` passed 15/15 projects. Review the
same packaged executable that produced the final evidence, rather than making
an untracked current-worktree build:

```powershell
& "tmp\release-candidate\task-112-2643a94c-final3\checkout\apps\desktop\out\LightTable-win32-x64\LightTable.exe"
```

Record the review in:

`tmp/release-candidate/task-112-2643a94c-final3/owner-acceptance/owner-checklist.md`

The associated machine-readable automation report is `report.json` in the
same directory. It records `production-packaged`, 15 projects awaiting owner
review and zero automation defects. A later build requires a new exact-commit
rehearsal; its checklist must not be mixed with this candidate's sign-off.

Defects use one schema: stable ID, severity, workflow, expected behavior,
evidence, owner and regression route. Automation failures default to P1 because
they invalidate a declared launch workflow. Repeated observations must update
the same record. Feature requests are recorded outside this release-blocker
list.
