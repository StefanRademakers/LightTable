# LightTable app contributor instructions

## Before editing

After a fresh session or context collapse, run `npm run context:agent` from the
repository root and follow `architecture/AGENT_ONBOARDING.md`. Read only the
system contracts routed by the requested change. Existing worktree changes
belong to the current collaboration unless proven otherwise.

## UI work

Before changing visible UI, read
`../../architecture/UI_WORKSPACE_AND_DESIGN_SYSTEM.md` and inspect the existing
components under `src/ui`, `src/lighttable/editor/ui/ToolOptionControls.tsx` and
`src/lighttable/editor/ui/PanelControls.tsx`.

Treat visible UI and UX as a compatibility surface. Be creative when
consolidating internal systems, removing duplicate paths or finding faster
implementations, but be deliberately conservative in presentation and
interaction design. Do not invent a new control language, layout convention,
gesture or visual treatment when an existing LightTable pattern or supplied
reference covers the need. Consistency takes priority over local novelty.

The live **View > UI Style Guide...** screen is a required gate, not optional
documentation. Inspect its relevant category, production precedents and the
applicable `architecture/ux/` material before implementing visible UI. If
those sources and an owner-supplied reference still leave a product decision
open, ask the owner instead of silently improvising. Any deliberately
provisional treatment must be called out plainly at handoff and requested for
review; never present guesswork as finished design. A new shared pattern or
materially new state belongs in the guide and its desktop visual smoke in the
same change.

- Reuse the canonical control for buttons, selects, sliders, switches, numeric
  fields, colors, gradients, menus and dialogs.
- Feature CSS may arrange controls, but must not redefine their sizing, border,
  radius, typography, focus, hover, active or disabled language.
- If a required control does not exist, add one generic primitive under
  `src/ui`, test all relevant states, and use that primitive from the feature.
- A new shared control or canonical dialog composition must also be represented
  in the live **View > UI Style Guide...** catalog.
- Do not add a raw private `input[type=range]`, dropdown, button skin, switch or
  paint field when an existing LightTable primitive covers the interaction.
- Validate UI changes with the relevant desktop smoke/audit at production
  scale, not only component markup tests.
