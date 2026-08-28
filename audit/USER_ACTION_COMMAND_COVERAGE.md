# User action / command coverage

Generated from the central editor menu on 2026-08-28. This is the first checked surface, not complete application coverage.

## Current measured surface

- 117 unique static executable menu actions plus 10 dynamic families;
- 64 already routed through semantic commands;
- 0 have a semantic command but still bypass it in this UI path;
- 24 host/workspace operations;
- 38 presentation-only operations;
- 1 genuine semantic command gaps;
- 10 checked dynamic menu families.

## Meaning

A command-owner entry has a catalog command and canonical implementation, but this UI path still calls the owner directly; an Actions recorder would therefore miss it. A gap means the user can perform the operation through the normal UI but the central semantic command catalog cannot yet express it. Host and presentation classifications are not automatically MCP edits, but still need an explicit agent product decision later.

## Menu inventory

| Menu action | Classification | Command or reason | Source line(s) |
| --- | --- | --- | --- |
| `about` | presentation | Opens application information; no document mutation. | 923 |
| `actual-size` | command | `view.setZoom` | 948 |
| `add-mask` | command | `layer.setMask` | 798 |
| `ai-history` | presentation | Shows the AI Assets panel. | 435 |
| `ai-provider-openart` | host | Changes an external provider connection. | 414 |
| `apply-auto-align` | command | `layer.autoAlign` | 858 |
| `assign-profile-srgb` | command | `document.assignProfile` | 386 |
| `auto-align` | presentation | Starts transient GPU analysis and compositor preview; Apply commits layer.autoAlign. | 868 |
| `border-selection` | command | `selection.modify` | 478 |
| `cancel-auto-align` | presentation | Cancels transient analysis/preview without mutating document state. | 863 |
| `canvas-size` | command | `document.applyGeometry` | 626 |
| `clear-guides` | presentation | Changes document-view guides, not image content. | 1019 |
| `clear-recent` | host | Changes host-maintained recent-file state. | 239 |
| `clear-recent-projects` | host | Changes host-maintained recent-project state. | 296 |
| `clear-selection` | command | `selection.modify` | 466 |
| `clipping-mask` | command | `layer.setClipping` | 781 |
| `close-project` | host | Changes host project lifecycle state. | 304 |
| `command-help` | presentation | Opens command documentation. | 915 |
| `convert-text-to-shape` | command | `text.convertToShape` | 820, 905 |
| `contract-selection` | command | `selection.modify` | 496 |
| `copy-grade` | command | `grade.copy` | 350 |
| `copy-merged-content` | command | `selection.copyPixels` | 336 |
| `copy-selected-content` | command | `selection.copyPixels` | 329 |
| `cut-selected-content` | command | `selection.cutPixels` | 322 |
| `delete-layer` | command | `layer.delete` | 722 |
| `duplicate-image` | command | `document.duplicate` | 660 |
| `duplicate-layer` | command | `layer.duplicate` | 713 |
| `edit-layer-mask` | presentation | Changes the active editing channel. | 803 |
| `edit-layer-pixels` | presentation | Changes the active editing channel. | 788 |
| `exit-application` | host | Closes the desktop host application and belongs to host lifecycle control. | 310 |
| `export-jpeg` | host | Runs the local save/download flow; Actions and MCP use file.exportBitmap with the same codec owner. | 267 |
| `export-png-native` | host | Runs the local save/download flow; Actions and MCP use file.exportPng with the same renderer output. | 266 |
| `export-pdf` | host | Runs an interactive local PDF export flow. | 273 |
| `export-png` | host | Runs a local download flow distinct from file.exportPng artifact creation. | 254 |
| `export-psd` | host | Runs a local download flow distinct from file.exportPsd artifact creation. | 270 |
| `export-psd-appearance` | host | Runs an interactive maximum-appearance PSD export flow. | 271 |
| `export-svg` | host | Runs a local download flow; Actions and MCP use file.exportSvg with the same exact serializer. | 272 |
| `export-tiff` | host | Runs the local save/download flow; Actions and MCP use file.exportBitmap with the same codec owner. | 269 |
| `export-webp` | host | Runs the local save/download flow; Actions and MCP use file.exportBitmap with the same codec owner. | 268 |
| `expand-selection` | command | `selection.modify` | 490 |
| `extras` | presentation | Toggles canvas overlays. | 973 |
| `feather-selection` | command | `selection.modify` | 502 |
| `fit` | command | `view.setZoom` | 941 |
| `flatten-group` | command | `layer.flattenGroup` | 889 |
| `flatten-image` | command | `document.flattenImage` | 895 |
| `flip-canvas-horizontal` | command | `document.applyGeometry` | 648 |
| `flip-canvas-vertical` | command | `document.applyGeometry` | 651 |
| `format-support` | presentation | Opens format-support information. | 274 |
| `guided-sample` | host | Starts an application-level guided workflow. | 916 |
| `image-crop` | command | `document.applyGeometry` | 655 |
| `image-rotation-180` | command | `document.applyGeometry` | 636 |
| `image-rotation-arbitrary` | command | `document.applyGeometry` | 645 |
| `image-rotation-clockwise-90` | command | `document.applyGeometry` | 639 |
| `image-rotation-counter-clockwise-90` | command | `document.applyGeometry` | 642 |
| `image-size` | command | `document.resizeImage` | 619 |
| `import-svg` | command | `vector.importSvg` | 223 |
| `invert-layer-colors` | command | `raster.invert` | 767 |
| `invert-selection` | command | `selection.modify` | 459 |
| `layer-via-copy` | command | `layer.copyToNewLayer` | 705 |
| `lock-guides` | presentation | Changes document-view guide interaction. | 1018 |
| `merge-down` | command | `layer.merge` | 881 |
| `move-down` | command | `layer.move` | 850 |
| `move-up` | command | `layer.move` | 845 |
| `new-document` | command | `document.create` | 203 |
| `new-guide` | presentation | Creates a document-view guide, not image content. | 1017 |
| `new-layer` | command | `layer.createRaster` | 700 |
| `new-project` | host | Changes host project lifecycle state. | 277 |
| `open-image` | host | Uses a local file picker; file.openArtifact targets registered artifacts. | 210 |
| `open-project` | host | Uses a host project picker. | 284 |
| `paste-grade` | command | `grade.paste` | 357 |
| `paste-selected-content` | command | `selection.pastePixels` | 343 |
| `place-image` | host | Uses a local file picker before layer.placeArtifact can apply. | 217 |
| `rasterize-text` | command | `text.rasterize` | 829 |
| `remove-background` | command | `layer.removeBackground` | 524, 775 |
| `remove-mask` | command | `layer.setMask` | 813 |
| `remove-object` | gap | No semantic object-removal command exists. | 517 |
| `reload-ui` | host | Reloads the development renderer host without mutating a document. | 929 |
| `rename-layer` | command | `layer.rename` | 749 |
| `reset-workspace-layout` | presentation | Resets local panel layout. | 1031 |
| `rulers` | presentation | Toggles canvas rulers. | 989 |
| `save-corrected` | host | Writes through the current source/host save workflow. | 247 |
| `select-all` | command | `selection.modify` | 445 |
| `select-none` | command | `selection.modify` | 452 |
| `select-similar` | command | `selection.modify` | 511 |
| `settings` | presentation | Opens application preferences. | 399 |
| `show-actions-panel` | presentation | Shows the Actions panel. | 1052 |
| `show-ai-history-panel` | presentation | Shows the AI Assets panel. | 1048 |
| `show-debug-panel` | presentation | Shows the Debug panel. | 933, 1056 |
| `show-difference` | presentation | Toggles a diagnostic viewport comparison. | 955 |
| `show-genai-panel` | presentation | Shows the GenAI panel. | 1044 |
| `show-grid` | presentation | Toggles the canvas grid. | 984 |
| `show-guides` | presentation | Toggles canvas guides. | 985 |
| `show-smart-guides` | presentation | Toggles smart guides. | 986 |
| `smooth-selection` | command | `selection.modify` | 484 |
| `snap` | presentation | Changes local snapping behavior. | 995 |
| `snap-all` | presentation | Changes local snapping behavior. | 1009 |
| `snap-document` | presentation | Changes local snapping behavior. | 1008 |
| `snap-grid` | presentation | Changes local snapping behavior. | 1006 |
| `snap-guides` | presentation | Changes local snapping behavior. | 1005 |
| `snap-layers` | presentation | Changes local snapping behavior. | 1007 |
| `snap-none` | presentation | Changes local snapping behavior. | 1010 |
| `third-party-licenses` | presentation | Opens legal information. | 917 |
| `toggle-lock` | command | `layer.setLock` | 874 |
| `toggle-developer-tools` | host | Toggles the desktop host developer tools in development builds. | 931 |
| `toggle-mask` | command | `layer.setMask` | 808 |
| `toggle-screen-mode` | presentation | Changes application window presentation. | 966 |
| `toggle-visibility` | command | `layer.setVisibility` | 835 |
| `transform-flip-horizontal` | command | `transform.applyFixed` | 375 |
| `transform-flip-vertical` | command | `transform.applyFixed` | 377 |
| `transform-rotate-180` | command | `transform.applyFixed` | 369 |
| `transform-rotate-clockwise-90` | command | `transform.applyFixed` | 371 |
| `transform-rotate-counter-clockwise-90` | command | `transform.applyFixed` | 373 |
| `ui-style-guide` | presentation | Opens the developer UI style guide. | 935, 1061 |
| `workspace-ai-generation` | presentation | Applies a local workspace layout preset. | 1029 |
| `workspace-grading` | presentation | Applies a local workspace layout preset. | 1028 |
| `workspace-photo-edit` | presentation | Applies a local workspace layout preset. | 1027 |
| `workspace-video` | presentation | Applies a local workspace layout preset. | 1030 |

## Dynamic menu families

| Value expression | Classification | Command or reason | Source line |
| --- | --- | --- | --- |
| `\`filter-${definition.kind}\`` | command | `adjustment.create` | 549 |
| `\`filter-attach-${definition.kind}\`` | command | `adjustment.create` | 554 |
| `\`layer-add-adjustment-${definition.id}\`` | command | `adjustment.create` | 671 |
| `\`layer-attach-adjustment-${definition.id}\`` | command | `adjustment.create` | 677 |
| `\`layer-add-effect-${kind}\`` | command | `adjustment.create` | 742 |
| `\`open-recent-${file.id}\`` | host | Opens a host-maintained local recent-file entry. | 234 |
| `\`open-recent-project-${project.recentId}\`` | host | Opens a host-maintained recent-project entry. | 290 |
| `\`image-adjustments-${definition.id}\`` | command | `adjustment.create` | 584 |
| `\`blend-${mode.id}\`` | command | `layer.setBlendMode` | 760 |
| `\`workspace-panel-${panel.id}\`` | presentation | Shows or hides a registered workspace panel. | 1039 |

## Toolbar inventory

- 37 registered tools;
- 33 have a recorded UI/command route;
- 2 have a canonical owner but no proven UI/command vertical;
- 0 are explicitly not exposed.

| Tool | Role | Interaction | Availability | Capability | Note |
| --- | --- | --- | --- | --- | --- |
| `transform` | transform | continuous | ui-and-command | `layer.setTransform` | Single-layer affine UI commits record one final matrix; groups, masks and projective transforms remain open. |
| `select-rectangle` | selection | continuous | ui-and-command | `selection.applyShape` | The UI records one final rectangle only after successful selection rasterization. |
| `select-ellipse` | selection | continuous | ui-and-command | `selection.applyShape` | The UI records one final ellipse only after successful selection rasterization. |
| `select-horizontal` | selection | discrete | ui-and-command | `selection.applyShape` | The UI records one final row selection. |
| `select-vertical` | selection | discrete | ui-and-command | `selection.applyShape` | The UI records one final column selection. |
| `select-free` | selection | continuous | ui-and-command | `selection.applyShape` | The UI records the bounded final outline, never pointer-move commands. |
| `select-polygonal` | selection | continuous | ui-and-command | `selection.applyShape` | The UI records the bounded final polygon, never intermediate clicks. |
| `select-object` | selection | continuous | canonical-owner-only | none | Smart-selection owner exists; model/result contract is not exposed. |
| `select-magic-wand` | selection | discrete | ui-and-command | `selection.applyMagicWand` | One successful asynchronous GPU selection publishes its sampled recipe; masks remain local. |
| `select-paint-brush` | selection | continuous | ui-and-command | `tool.commitGesture:selection-paint` | One GPU-native selection-mask stroke records after its reversible selection commit. |
| `vector-pen` | vector | continuous | ui-and-command | `vector.create`, `vector.update` | Open/closed and resumed Pen paths publish once after commit; anchor and handle previews remain local. |
| `vector-add-anchor` | vector | discrete | ui-and-command | `vector.update` | One-shot add records the final native path. |
| `vector-delete-anchor` | vector | discrete | ui-and-command | `vector.update`, `vector.remove` | One-shot delete records the final native path or its removal. |
| `vector-convert-anchor` | vector | continuous | ui-and-command | `vector.update` | Click/drag conversion records once after commit; previews remain local. |
| `vector-select` | vector | presentation | presentation-only | none | Vector target selection is editor presentation state. |
| `vector-direct-select` | vector | continuous | ui-and-command | `vector.update` | Selection/marquee remain presentation; anchor, handle and segment edits record once after commit. |
| `shape-rectangle` | vector | continuous | ui-and-command | `vector.create`, `vector.update` | The toolbar publishes one native Rectangle only after its local preview commits. |
| `shape-ellipse` | vector | continuous | ui-and-command | `vector.create`, `vector.update` | The toolbar publishes one native Ellipse only after its local preview commits. |
| `shape-triangle` | vector | continuous | ui-and-command | `vector.create`, `vector.update` | The toolbar publishes one native Triangle only after its local preview commits. |
| `shape-line` | vector | continuous | ui-and-command | `vector.create`, `vector.update` | The toolbar publishes one native Line only after its local preview commits. |
| `text-point` | text | discrete | ui-and-command | `text.create`, `text.replaceRange`, `text.format`, `text.setLayout` | Point text already enters through semantic commands. |
| `text-paragraph` | text | continuous | ui-and-command | `text.create`, `text.replaceRange`, `text.format`, `text.setLayout` | Paragraph text creation and editing already use semantic commands. |
| `text-vertical` | text | discrete | ui-and-command | `text.create`, `text.replaceRange`, `text.format`, `text.setLayout` | Vertical text uses the shared text contract. |
| `text-path` | text | discrete | ui-and-command | `text.create` | Path Text creation references existing native path geometry through the shared text command. |
| `gradient` | vector | continuous | ui-and-command | `vector.create`, `vector.update`, `raster.applyGradient` | Fill-layer and raster modes publish one final paint after commit; drag previews remain local. |
| `fill` | fill | discrete | ui-and-command | `raster.fill` | One successful GPU fill publishes one explicit layer/channel operation; pixels and selection stay local. |
| `brush` | paint | continuous | ui-and-command | `tool.commitGesture:brush-stroke` | Actions captures one bounded stroke only while recording; pointer updates stay on the local paint hot path. |
| `healing-brush` | paint | continuous | ui-and-command | `tool.commitGesture:brush-stroke` | Final stroke carries a document-relative sampled source; source pixels and dabs remain local. |
| `clone-stamp` | paint | continuous | ui-and-command | `tool.commitGesture:brush-stroke` | Final stroke carries a document-relative sampled source; source pixels and dabs remain local. |
| `erase` | paint | continuous | ui-and-command | `tool.commitGesture:brush-stroke` | Erase records through the same bounded stroke contract with erase=true. |
| `dodge` | paint | continuous | ui-and-command | `tool.commitGesture:brush-stroke` | One bounded tone stroke publishes after commit; pointer updates stay on the local paint hot path. |
| `burn` | paint | continuous | ui-and-command | `tool.commitGesture:brush-stroke` | One bounded tone stroke publishes after commit; pointer updates stay on the local paint hot path. |
| `sponge` | paint | continuous | ui-and-command | `tool.commitGesture:brush-stroke` | One bounded tone stroke publishes after commit; pointer updates stay on the local paint hot path. |
| `warp` | warp | continuous | ui-and-command | `warp.applyStroke` | UI previews remain frame-coalesced; one bounded layer-source stroke publishes after history commit. |
| `face-warp` | face-warp | discrete | canonical-owner-only | `faceWarp.applyOperation` | Semantic operations exist but remain experimentally excluded from MCP. |
| `view` | view | presentation | presentation-only | none | Canvas navigation is viewport presentation. |
| `zoom` | zoom | presentation | ui-and-command | `view.setZoom` | Zoom state has a semantic command; click-drag zoom remains local. |
