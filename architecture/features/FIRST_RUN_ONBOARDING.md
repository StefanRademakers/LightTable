# First-run onboarding

Status: current product contract, 6 August 2026.

## Minimum first session

A new user can start with their own file, a blank document or the optional
guided sample. The successful guided path is:

1. create a real 960 x 640 sRGB document;
2. create and select an editable vector shape;
3. undo the shape as one semantic history entry;
4. redo the same layer;
5. render and save a flattened PNG;
6. export and save a layered Photoshop PSD.

The coach calls `LightTableCommandService`; it has no demo document model or
renderer. Each transition queries canonical document state (layer type,
selection, history or completed export artifact) before advancing. It stays in
one small non-modal card, may be dismissed, and can be restarted from Help.

## Product language

The launcher explains that editing is local-first, names the principal input
formats and says that unsupported source features are preserved with a preview
and reported before export. “Subset” is never presented as full compatibility.
The guide deliberately demonstrates both the simple flattened path and the
layered interoperability path.

`Help -> Commands and Shortcuts` provides searchable command help. It calls out
Photoshop-compatible shortcuts only where LightTable performs the same action.
The Help menu also restarts the guided sample.

## Privacy boundary

Onboarding funnel events use the optional `LightTableFunnelTelemetry` host
capability. The app has no dependency on it. The current browser and desktop
adapters are disabled by default and, after explicit opt-in, retain at most 100
event names/timestamps in local storage. They contain no filenames, paths,
document content or properties and perform no network request. Opt-out deletes
the local history. A later remote adapter requires a separate product/privacy
decision; it must not change editor behavior.

## Verification

`npm run smoke:desktop:onboarding` launches a fresh isolated profile, switches
the browser context offline, completes the real vector/undo/redo/PNG/PSD flow,
checks artifact signatures, searches command help and captures 1024 x 768 and
1440 x 900 screenshots. The test waits on semantic UI/document results rather
than fixed sleep intervals. The general accessibility and packaged desktop
gates remain required.
