# Result

Completed and re-verified in the real desktop application on 2026-08-12.

- `ColorSwatchField` is the single production solid-color control used by the
  toolbar, tool options, panel effects, gradient-stop editors and dialogs.
- No native `input[type="color"]` path remains in the application source.
- The shared custom picker is rendered through a viewport-clamped portal. It
  chooses the free side of its trigger and remains inside the Electron window.
- Manual HEX/RGB edits and the screen sampler update the same value.
- Outside click commits the interaction; Escape restores the exact value from
  when the picker opened.
- Gradient color stops use the same production picker rather than a separate
  gradient-only color control.

## Verification

- `npm run smoke:desktop:color-picker`
  - opened the real foreground swatch in Electron;
  - changed and committed its HEX value;
  - cancelled another change with Escape and verified restoration;
  - opened a real Gradient Tool editor and changed a selected color stop;
  - verified commit and Escape cancellation on that stop;
  - measured both popovers inside the viewport and outside their triggers;
  - captured `tmp/color-picker-smoke/production-color-picker.png`.
- `npm run typecheck --workspace @lighttable/app`
- Focused color/gradient component tests: 7 passed.
