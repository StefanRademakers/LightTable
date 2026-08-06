# Code quality and latency audit — 6 August 2026

Status: complete baseline scan. This is a guardrail and ranked refactor map,
not a claim that every large integration module has already disappeared.

## Evidence

- Architecture boundary verification passes.
- All workspace typechecks pass.
- 312 application test files / 1,665 application tests and every package suite
  pass in the production-oriented quick profile.
- The Web production build passes.
- Twenty-seven tools survive six complete UI-switch rounds with stable DOM and
  listeners, +0.19 MiB post-GC heap variation and no page/console/runtime error.
- Six endurance rounds pass on editable text PSD, vector/shape PSD and PDF;
  stable-tail heap variation is 55–115 KiB with no suspicious retention signal.
- Layer Style continuous interaction is bounded to an actual 16.88 submitted
  frames/s under 121 input changes and no longer writes disposable interactive
  results into the persistent style cache.

## Large production modules

The scan found ten non-test production files above 1,000 lines. They are now
explicitly capped in `tests/source-structure-baseline.json`; a new file above
1,000 lines, growth above a current cap, or a stale exception fails
`npm run audit:source-structure`.

The two primary risks remain:

1. `LightTableEditorOverlay.tsx` (4,344 measured lines) is still an integration root. It
   now wires many typed controllers and keeps pointer-frequency state in refs or
   external stores, but its lifecycle ordering and command wiring are difficult
   to review. Do not add new operational behavior or durable model state here.
   Extract one cohesive controller at a time with controller tests and the full
   tool/endurance gates.
2. `WebGpuEngine.ts` (2,266 measured lines) is still a renderer facade. Optional effects,
   scopes, viewport presentation, layer rendering and resource stores have
   owners, but the facade still coordinates initialization and submission.
   Continue extraction by resource lifetime/output product; do not introduce a
   generic manager or parallel compositor.

The other large files are cohesive but should be split by stable domain rather
than arbitrary line count: shader libraries by pass family, text coordination
by scheduling/publication, document commands by semantic layer family,
persistence by schema section, and UI panels by property group.

## Measured latency risks

- Text shaping/GPU raster is not the dominant caret cost. Scheduling and worker
  tail latency still occasionally exceed the ordinary one-frame target; retain
  the provisional edit preview and exact settled shaping gates.
- PSD first open remains dominated by parse/decode and eager editable source
  hydration on large templates. Keep retained-composite-first plus bounded
  semantic hydration as the intended direction.
- Large Layer Style documents are expensive to recomposite. The UI is now
  locally responsive and expensive publication bounded to 30 Hz; a future
  change should reduce affected render regions/subtrees, not increase React
  update cadence.
- Renderer-owned GPU memory is bounded but high on large documents. The measured
  resource register explicitly rejected warm-latency regressions and unproven
  cold backing/replay systems.

## Boundary conclusions

- `ImageDocument` remains the semantic authority; GPU textures are derived or
  editable runtime resources with explicit ownership.
- The compositor remains the single layer-evaluation authority.
- UI/tools do not import a second renderer or store GPU handles in React state.
- Desktop automation and future MCP consume the typed command boundary rather
  than clicking private UI where a semantic command exists.
- Current tests cover teardown, dirty scheduling, cache ownership, document
  history and host boundaries. Physical leak/tool-switch audits complement but
  do not replace those unit contracts.

## Refactor rule

Large-file caps are ratchets, not permanent exemptions. Lower a cap whenever a
cohesive extraction lands. Never raise one merely to make the audit green. A
refactor is accepted only with unchanged semantic state, visual output,
interaction latency and complete quality profiles.
