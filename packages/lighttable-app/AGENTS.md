# LightTable app contributor instructions

## UI work

Before changing visible UI, read
`../../architecture/UI_WORKSPACE_AND_DESIGN_SYSTEM.md` and inspect the existing
components under `src/ui`, `src/lighttable/editor/ui/ToolOptionControls.tsx` and
`src/lighttable/editor/ui/PanelControls.tsx`.

- Reuse the canonical control for buttons, selects, sliders, switches, numeric
  fields, colors, gradients, menus and dialogs.
- Feature CSS may arrange controls, but must not redefine their sizing, border,
  radius, typography, focus, hover, active or disabled language.
- If a required control does not exist, add one generic primitive under
  `src/ui`, test all relevant states, and use that primitive from the feature.
- A new shared control must also be represented in the UI Style Guide/catalog
  once that catalog exists.
- Do not add a raw private `input[type=range]`, dropdown, button skin, switch or
  paint field when an existing LightTable primitive covers the interaction.
- Validate UI changes with the relevant desktop smoke/audit at production
  scale, not only component markup tests.
