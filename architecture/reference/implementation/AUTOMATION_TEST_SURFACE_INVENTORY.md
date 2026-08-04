# Automation test surface inventory

Status: implemented baseline

Last reviewed: 2026-08-04

## Typed deterministic product tests

These scripts use `scripts/lighttable-automation-driver.mjs`. Setup and
assertions read bounded projections and invoke the same registered commands as
the UI. They do not mutate document objects or React state directly.

- `smoke-desktop-command-driver.mjs`: commands, async PNG artifact, task
  completion and brush/selection/translation gestures;
- `capture-lighttable-layer-references.mjs`: deterministic layer lookup and
  context/solo visibility setup;
- `capture-lighttable-layer-style-references.mjs`: effect bypass, stacked
  effects, fill opacity and zoom setup;
- `smoke-desktop-tight-merge.mjs`: typed state/history assertions around the
  intentionally physical `Ctrl+E` merge shortcut.

The initial open-button click remains physical because it exercises the
Electron host/open seam. The source path is supplied through the opt-in
automation launch environment, not a production global.

## Physical UI, event and visual tests

These scripts deliberately keep selectors, clicks, keys, pointer motion or
screenshots because that behavior cannot be established by a command result:

- `capture-desktop-screenshot.mjs`: end-to-end editor UI, document tabs,
  semantic text/vector editing, save/reopen and screenshots;
- `smoke-desktop-paragraph.mjs`: paragraph pointer/caret UI behavior;
- `smoke-desktop-system-fonts.mjs`: desktop font picker and missing-font UX;
- `smoke-desktop-tight-merge.mjs`: layer selection plus physical shortcut;
- `stress-desktop-editor.mjs`: focus, pointer and repeated UI interaction;
- the two LightTable reference capture scripts retain screenshots and minimal
  panel hiding after their deterministic setup.

## External adapter boundary

`AuthenticatedLightTableMcpAdapter` is a transport-neutral adapter over the
same automation driver. It is disabled unless a host explicitly constructs an
enabled session. It opens no listener and installs no global. Sessions require
a capability token of at least 24 characters, have an absolute expiry,
request limit, revocation, a fixed method/command allowlist and a bounded
64-entry activity projection.

Input artifact registration and `file.openArtifact` are intentionally absent
from the MCP allowlist. A future desktop transport must perform local-user
consent and host file selection before registering an input. Export returns
only task and opaque artifact metadata.

## Invariants

- Test-only driver installation remains an explicit desktop launch capability.
- No raw GPU objects, files or arbitrary functions cross the public boundary.
- Gesture samples are bounded by the command service and commit once.
- Unsupported external methods and commands reject; they never no-op.
- Network/named-pipe transport and its visible Settings/status UI remain host
  work, not hidden behavior in the application package.
