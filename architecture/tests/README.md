# Repeatable quality and parity tests

This directory is the durable entry point for engineers and coding agents.
Executable code remains under `scripts/`; generated reports remain under
`tmp/` or the external oracle corpus and are not committed.

## One command

```powershell
npm run quality:agent -- --profile quick
npm run quality:agent -- --profile desktop
npm run quality:agent -- --profile parity
npm run quality:agent -- --profile full
```

Every run writes a versioned JSON summary and one log per gate under
`tmp/quality-gates/<timestamp>/`. The runner stops at the first failed gate and
returns a non-zero exit code. Desktop builds happen once per profile. Desktop
smokes are discovered from `scripts/smoke-desktop-*.mjs`, so a correctly named
new feature smoke automatically joins the desktop and full profiles.

Profiles:

- `quick`: boundaries, source/documentation audits, all typechecks/tests and
  the production Web build;
- `desktop`: production desktop package, every desktop smoke, endurance and
  the high-frequency Layer Style interaction and all-tool switching gates;
- `parity`: production desktop package plus strict Photoshop Layer Style and
  blend/color corpus comparisons;
- `full`: all of the above.

The parity profile requires the local Photoshop oracle corpora. Override them
with `--effects-root`, `--blend-root`, and the numeric blend gate with
`--max-rmse`. A missing oracle is a failure, never a silent skip.

The quick/full profiles also run the ownership-aware source-structure audit.
The 1,000-line signal triggers a required human-readable ownership review; it
is not a success target. Reviews distinguish mixed authority from cohesive
heavy systems and record responsibilities, fan-out, lifecycle ownership,
product risk and the extraction decision. Material growth reopens that review.
Generated sources require an exact marker, generator, byte/hash accountability
and load-boundary reason rather than polluting the handwritten ranking.

After the production web build, the delivery audit records raw, gzip and Brotli
cost for initial JavaScript/CSS and every heavyweight lazy asset, with the user
flow that owns it. Its current budget is a regression band around a dated
measured baseline and the named startup goal. The standalone launcher is a
separate package entry and does not load the document editor until the first
document is materialized. The 2026-08-20 production measurement is 0.89 MB raw
initial JavaScript and 74.5 kB raw initial CSS; the first-document editor
runtime remains an explicitly owned 2.06 MB lazy JavaScript asset. These are
load-boundary measurements, not claims about interaction speed after opening a
document.

## Test-writing contract

For a new tool or feature, add focused unit/contract tests and a packaged smoke
named `scripts/smoke-desktop-<feature>.mjs`. The smoke must exercise the public
command or real UI, verify a semantic state change, watch page/console/runtime
errors, and close its Electron process in `finally`. Pixel-sensitive work also
needs a stable reference/difference gate. Performance work records the active
event count; a test that did not trigger the intended action is a failed test.

`smoke:desktop:document-capabilities` includes the packaged UI -> Actions ->
external-MCP route gate for document geometry and Assign Profile. The profile
slice begins with an untagged PNG, requires one reversible metadata change,
rejects a repeated history entry and compares source/UI/Actions/MCP previews
with a strict zero-delta policy.

Leak and crash triage can be run alone with:

```powershell
npm run stress:desktop:build -- --iterations 10
npm run audit:desktop:tool-switching:build -- --iterations 10
```

The packaged accessibility journey can be run independently with:

```powershell
npm run smoke:desktop:accessibility:build
```

It verifies real keyboard focus from launcher through layer edit, undo, native
save and quick export, scans visible controls for accessible names, and captures
forced-colors plus reduced-motion evidence. The manual assistive-technology
matrix is defined in [Accessibility, keyboard and focus](../ACCESSIBILITY_KEYBOARD_AND_FOCUS.md).

Supported-hardware retention and interaction evidence uses:

```powershell
npm run soak:desktop:release:build -- --profile ci
npm run soak:desktop:release:build -- --profile overnight
```

The first is bounded and joins desktop/full quality. The second requests at
least twelve hours and must be run on each physical hardware class being
claimed. Contract and current evidence: [Supported hardware and release soak](../SUPPORTED_HARDWARE_AND_SOAK_GATE.md).

The first gate restores every interaction to its reference state before forced
GC and checks stable-tail heap, DOM, listeners and renderer-owned GPU bytes. The
second reaches every toolbar/flyout tool each round, detects stopped document
runtimes, page/console errors and the same CPU-side retention signals.

See [repeatable parity gates](REPEATABLE_PARITY_GATES.md) for fixture ownership
and interpretation.
