# Result

Re-verified against the complete desktop workflow on 2026-08-12.

- Preferences > Projects now uses the supplied two-column folder-mapping layout with LightTable's shared `FormInput` and `ActionButton` controls.
- Standard semantic project folders remain explicit mappings; custom folders can be added, removed and reordered.
- The dialog uses the larger Preferences workspace instead of the previous cramped form layout.
- `scripts/smoke-desktop-project-preferences.mjs` verifies the real Electron UI, persistence after closing/reopening Preferences, and creation of the configured custom directory in a new project.
- Repaired the project-lifecycle acceptance test so it operates on the active document runtime when multiple documents are open instead of clicking a hidden editor copy.
- `smoke:desktop:project-lifecycle` now verifies New Project, the clickable project indicator, Close Project, Recent Projects reopen, unchanged open-document tabs and active-project restoration after reload.
- Both project smokes are exposed as package scripts and pass without renderer/page errors. Evidence screenshots are in `tmp/smoke-project-preferences/project-preferences.png` and `tmp/smoke-project-lifecycle/project-lifecycle.png`.
- `npm run typecheck --workspace @lighttable/app` passes.
