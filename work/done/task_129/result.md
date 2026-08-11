# Result

Completed and re-verified on 2026-08-12.

- Preferences > Projects now uses the supplied two-column folder-mapping layout with LightTable's shared `FormInput` and `ActionButton` controls.
- Standard semantic project folders remain explicit mappings; custom folders can be added, removed and reordered.
- The dialog uses the larger Preferences workspace instead of the previous cramped form layout.
- `scripts/smoke-desktop-project-preferences.mjs` verifies the real Electron UI, persistence after closing/reopening Preferences, and creation of the configured custom directory in a new project.
- `npm run typecheck --workspace @lighttable/app` passes.
