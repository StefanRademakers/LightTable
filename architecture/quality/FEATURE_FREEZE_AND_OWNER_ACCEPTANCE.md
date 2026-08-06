# Feature freeze and owner acceptance

Status: feature freeze active from 6 August 2026; automation ready, owner sign-off pending.

Until Task 108 closes, only measured P0/P1 release blockers, regression-test
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
of preserved/raster fallbacks. Task 108 remains open until the three sign-off
boxes in the generated checklist are explicitly approved.

Defects use one schema: stable ID, severity, workflow, expected behavior,
evidence, owner and regression route. Automation failures default to P1 because
they invalidate a declared launch workflow. Repeated observations must update
the same record. Feature requests are recorded outside this release-blocker
list.
