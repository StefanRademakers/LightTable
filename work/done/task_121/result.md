# Task 121 result — Smart Object Selection

Status: visibly working and reverified in the real Electron application on
2026-08-12. The earlier contract-only completion claim was rejected and is not
used as evidence here.

## Repaired in the acceptance pass

- Fixed a React Strict Mode lifecycle defect that permanently disposed the
  ref-owned Object Selection controller during development startup. Every click
  previously reached a dead controller and therefore produced no selection.
- Prevented Object Finder hover inference from superseding an in-flight click.
  A click is now authoritative until its mask has committed.
- Made raster-mask commits awaitable and atomic. The translucent GPU candidate
  stays visible until the authoritative GPU selection texture is live and the
  normal selection/history state is published. A failed commit no longer clears
  the only visible feedback.
- The committed result uses the existing GPU SelectionContourOverlayBackend:
  black/white animated marching ants, one device pixel wide, with no CSS/SVG
  selection rendering and no document recomposite.

## Evidence

- `SmartSelectionToolController` and shared selection-session tests: 255 tests
  green in the focused Vitest graph, including click-vs-hover concurrency and
  preview-to-persistent-mask handoff.
- App TypeScript project: green.
- Real Electron smoke: `npm run smoke:desktop:object-selection` opens
  `D:\face.jpg`, activates Object Selection through the toolbar, performs a
  real SlimSAM point selection, and requires a published raster-mask operation,
  active GPU selection texture and visible overlay.
- The inspected screenshot at
  `tmp/object-selection-smoke/object-selection-committed.png` shows the selected
  person bounded by the standard black/white marching-ants contour.

The smoke intentionally reports ONNX execution-provider warnings separately;
unexpected console errors and page errors still fail the run.
