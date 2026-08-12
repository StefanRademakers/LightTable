# Result

- Fixed the real multi-document failure: a document that starts inactive now publishes one non-blocking thumbnail directly after source hydration. It no longer needs to become visible first.
- The snapshot downsamples the existing final GPU texture to a 256 px longest edge; it does not add a second compositor or background render loop.
- Later composite changes continue to replace the cached thumbnail through the existing debounced path.
- Added `smoke:desktop:tab-thumbnails`, which drops a 320x180 and 180x320 document simultaneously, leaves the first tab inactive and never activates it, then verifies its hover preview is visible and exactly 256x144.
- Evidence: `tmp/tab-thumbnail-smoke/inactive-tab-preview.png` and `tmp/tab-thumbnail-smoke/report.json`.
- Verification: focused app typecheck and the real Electron smoke both pass.
