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

The quick/full profiles also run the source-structure ratchet. Known large
integration modules have explicit ceilings; new production files above 1,000
lines and growth above those ceilings fail. Lower exceptions after extraction;
never raise them simply to admit more behavior.

## Test-writing contract

For a new tool or feature, add focused unit/contract tests and a packaged smoke
named `scripts/smoke-desktop-<feature>.mjs`. The smoke must exercise the public
command or real UI, verify a semantic state change, watch page/console/runtime
errors, and close its Electron process in `finally`. Pixel-sensitive work also
needs a stable reference/difference gate. Performance work records the active
event count; a test that did not trigger the intended action is a failed test.

Leak and crash triage can be run alone with:

```powershell
npm run stress:desktop:build -- --iterations 10
npm run audit:desktop:tool-switching:build -- --iterations 10
```

The first gate restores every interaction to its reference state before forced
GC and checks stable-tail heap, DOM, listeners and renderer-owned GPU bytes. The
second reaches every toolbar/flyout tool each round, detects stopped document
runtimes, page/console errors and the same CPU-side retention signals.

See [repeatable parity gates](REPEATABLE_PARITY_GATES.md) for fixture ownership
and interpretation.
