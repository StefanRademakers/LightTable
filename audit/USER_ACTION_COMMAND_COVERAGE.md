# User action / command coverage

Generated from the central editor menu on 2026-09-10. This is the first checked surface, not complete application coverage.

## Current measured surface

- 120 unique static executable menu actions plus 11 dynamic families;
- 67 already routed through semantic commands;
- 0 have a semantic command but still bypass it in this UI path;
- 26 host/workspace operations;
- 38 presentation-only operations;
- 0 genuine semantic command gaps;
- 11 checked dynamic menu families.

## Meaning

A command-owner entry has a catalog command and canonical implementation, but this UI path still calls the owner directly; an Actions recorder would therefore miss it. A gap means the user can perform the operation through the normal UI but the central semantic command catalog cannot yet express it. Host and presentation classifications are not automatically MCP edits, but still need an explicit agent product decision later.

## Menu inventory

| Menu action | Classification | Command or reason | Source line(s) |
| --- | --- | --- | --- |
| `about` | presentation | Opens application information; no document mutation. | 957 |
| `actual-size` | command | `view.setZoom` | 982 |
| `add-mask` | command | `layer.setMask` | 814 |
| `apply-mask` | command | `layer.setMask` | 839 |
| `ai-history` | presentation | Shows the AI Assets panel. | 461 |
| `ai-provider-openart` | host | Changes an external provider connection. | 440 |
| `apply-auto-align` | command | `layer.autoAlign` | 892 |
| `assign-profile-srgb` | command | `document.assignProfile` | 412 |
| `auto-align` | presentation | Starts transient GPU analysis and compositor preview; Apply commits layer.autoAlign. | 902 |
| `border-selection` | command | `selection.modify` | 504 |
| `cancel-auto-align` | presentation | Cancels transient analysis/preview without mutating document state. | 897 |
| `canvas-size` | command | `document.applyGeometry` | 642 |
| `clear-guides` | presentation | Changes document-view guides, not image content. | 1053 |
| `clear-recent` | host | Changes host-maintained recent-file state. | 255 |
| `clear-recent-projects` | host | Changes host-maintained recent-project state. | 322 |
| `clear-selection` | command | `selection.modify` | 492 |
| `clipping-mask` | command | `layer.setClipping` | 797 |
| `close-project` | host | Changes host project lifecycle state. | 330 |
| `command-help` | presentation | Opens command documentation. | 949 |
| `convert-text-to-shape` | command | `text.convertToShape` | 854, 939 |
| `contract-selection` | command | `selection.modify` | 522 |
| `copy-grade` | command | `grade.copy` | 376 |
| `copy-merged-content` | command | `selection.copyPixels` | 362 |
| `copy-selected-content` | command | `selection.copyPixels` | 355 |
| `cut-selected-content` | command | `selection.cutPixels` | 348 |
| `delete-layer` | command | `layer.delete` | 738 |
| `duplicate-image` | command | `document.duplicate` | 676 |
| `duplicate-layer` | command | `layer.duplicate` | 729 |
| `edit-layer-mask` | presentation | Changes the active editing channel. | 819 |
| `edit-layer-pixels` | presentation | Changes the active editing channel. | 804 |
| `exit-application` | host | Closes the desktop host application and belongs to host lifecycle control. | 336 |
| `export-jpeg` | host | Runs the local save/download flow; Actions and MCP use file.exportBitmap with the same codec owner. | 293 |
| `export-png-native` | host | Runs the local save/download flow; Actions and MCP use file.exportPng with the same renderer output. | 292 |
| `export-pdf` | host | Runs an interactive local PDF export flow. | 299 |
| `export-png` | host | Runs a local download flow distinct from file.exportPng artifact creation. | 280 |
| `export-psd` | host | Runs a local download flow distinct from file.exportPsd artifact creation. | 296 |
| `export-psd-appearance` | host | Runs an interactive maximum-appearance PSD export flow. | 297 |
| `export-svg` | host | Runs a local download flow; Actions and MCP use file.exportSvg with the same exact serializer. | 298 |
| `export-tiff` | host | Runs the local save/download flow; Actions and MCP use file.exportBitmap with the same codec owner. | 295 |
| `export-webp` | host | Runs the local save/download flow; Actions and MCP use file.exportBitmap with the same codec owner. | 294 |
| `expand-selection` | command | `selection.modify` | 516 |
| `extras` | presentation | Toggles canvas overlays. | 1007 |
| `feather-selection` | command | `selection.modify` | 528 |
| `fit` | command | `view.setZoom` | 975 |
| `flatten-group` | command | `layer.flattenGroup` | 923 |
| `flatten-image` | command | `document.flattenImage` | 929 |
| `flip-canvas-horizontal` | command | `document.applyGeometry` | 664 |
| `flip-canvas-vertical` | command | `document.applyGeometry` | 667 |
| `format-support` | presentation | Opens format-support information. | 300 |
| `guided-sample` | host | Starts an application-level guided workflow. | 950 |
| `image-crop` | command | `document.applyGeometry` | 671 |
| `image-rotation-180` | command | `document.applyGeometry` | 652 |
| `image-rotation-arbitrary` | command | `document.applyGeometry` | 661 |
| `image-rotation-clockwise-90` | command | `document.applyGeometry` | 655 |
| `image-rotation-counter-clockwise-90` | command | `document.applyGeometry` | 658 |
| `image-size` | command | `document.resizeImage` | 635 |
| `import-svg` | command | `vector.importSvg` | 237 |
| `invert-layer-colors` | command | `raster.invert` | 783 |
| `invert-mask` | command | `layer.setMask` | 834 |
| `invert-selection` | command | `selection.modify` | 485 |
| `layer-via-copy` | command | `layer.copyToNewLayer` | 721 |
| `load-mask-selection` | command | `layer.setMask` | 829 |
| `lock-guides` | presentation | Changes document-view guide interaction. | 1052 |
| `merge-down` | command | `layer.merge` | 915 |
| `move-down` | command | `layer.move` | 884 |
| `move-up` | command | `layer.move` | 879 |
| `new-document` | command | `document.create` | 213 |
| `new-guide` | presentation | Creates a document-view guide, not image content. | 1051 |
| `new-layer` | command | `layer.createRaster` | 716 |
| `new-project` | host | Changes host project lifecycle state. | 303 |
| `open-file` | host | Uses a local file picker; file.openArtifact targets registered artifacts. | 225 |
| `open-project` | host | Uses a host project picker. | 310 |
| `paste-grade` | command | `grade.paste` | 383 |
| `paste-selected-content` | command | `selection.pastePixels` | 369 |
| `place-image` | host | Uses a local file picker before layer.placeArtifact can apply. | 231 |
| `rasterize-text` | command | `text.rasterize` | 863 |
| `remove-background` | command | `layer.removeBackground` | 550, 791 |
| `remove-mask` | command | `layer.setMask` | 847 |
| `remove-object` | host | Exports document and selection artifacts into the external GenAI project workflow; it does not mutate the open document. A returned artifact is admitted separately through layer.placeArtifact. | 543 |
| `reload-ui` | host | Reloads the development renderer host without mutating a document. | 963 |
| `rename-layer` | command | `layer.rename` | 765 |
| `reset-workspace-layout` | presentation | Resets local panel layout. | 1065 |
| `rulers` | presentation | Toggles canvas rulers. | 1023 |
| `save-corrected` | host | Writes through the current source/host save workflow. | 273 |
| `select-all` | command | `selection.modify` | 471 |
| `select-none` | command | `selection.modify` | 478 |
| `select-similar` | command | `selection.modify` | 537 |
| `settings` | presentation | Opens application preferences. | 425 |
| `show-actions-panel` | presentation | Shows the Actions panel. | 1086 |
| `show-ai-history-panel` | presentation | Shows the AI Assets panel. | 1082 |
| `show-debug-panel` | presentation | Shows the Debug panel. | 967, 1090 |
| `show-difference` | presentation | Toggles a diagnostic viewport comparison. | 989 |
| `show-genai-panel` | presentation | Shows the GenAI panel. | 1078 |
| `show-grid` | presentation | Toggles the canvas grid. | 1018 |
| `show-guides` | presentation | Toggles canvas guides. | 1019 |
| `show-smart-guides` | presentation | Toggles smart guides. | 1020 |
| `smooth-selection` | command | `selection.modify` | 510 |
| `snap` | presentation | Changes local snapping behavior. | 1029 |
| `snap-all` | presentation | Changes local snapping behavior. | 1043 |
| `snap-document` | presentation | Changes local snapping behavior. | 1042 |
| `snap-grid` | presentation | Changes local snapping behavior. | 1040 |
| `snap-guides` | presentation | Changes local snapping behavior. | 1039 |
| `snap-layers` | presentation | Changes local snapping behavior. | 1041 |
| `snap-none` | presentation | Changes local snapping behavior. | 1044 |
| `third-party-licenses` | presentation | Opens legal information. | 951 |
| `toggle-lock` | command | `layer.setLock` | 908 |
| `toggle-developer-tools` | host | Toggles the desktop host developer tools in development builds. | 965 |
| `toggle-mask` | command | `layer.setMask` | 824 |
| `toggle-screen-mode` | presentation | Changes application window presentation. | 1000 |
| `toggle-visibility` | command | `layer.setVisibility` | 869 |
| `transform-flip-horizontal` | command | `transform.applyFixed` | 401 |
| `transform-flip-vertical` | command | `transform.applyFixed` | 403 |
| `transform-rotate-180` | command | `transform.applyFixed` | 395 |
| `transform-rotate-clockwise-90` | command | `transform.applyFixed` | 397 |
| `transform-rotate-counter-clockwise-90` | command | `transform.applyFixed` | 399 |
| `ui-style-guide` | presentation | Opens the developer UI style guide. | 969, 1095 |
| `workspace-ai-generation` | presentation | Applies a local workspace layout preset. | 1063 |
| `workspace-grading` | presentation | Applies a local workspace layout preset. | 1062 |
| `workspace-photo-edit` | presentation | Applies a local workspace layout preset. | 1061 |
| `workspace-video` | presentation | Applies a local workspace layout preset. | 1064 |

## Dynamic menu families

| Value expression | Classification | Command or reason | Source line |
| --- | --- | --- | --- |
| `\`filter-${definition.kind}\`` | command | `adjustment.create` | 566 |
| `\`filter-attach-${definition.kind}\`` | command | `adjustment.create` | 571 |
| `\`layer-add-adjustment-${definition.id}\`` | command | `adjustment.create` | 687 |
| `\`layer-attach-adjustment-${definition.id}\`` | command | `adjustment.create` | 693 |
| `\`layer-add-effect-${kind}\`` | command | `adjustment.create` | 758 |
| `\`open-recent-${file.id}\`` | host | Opens a host-maintained local recent-file entry. | 250 |
| `\`open-recovery-${file.id}\`` | host | Opens a host-maintained local recovery artifact. | 267 |
| `\`open-recent-project-${project.recentId}\`` | host | Opens a host-maintained recent-project entry. | 316 |
| `\`image-adjustments-${definition.id}\`` | command | `adjustment.create` | 600 |
| `\`blend-${mode.id}\`` | command | `layer.setBlendMode` | 776 |
| `\`workspace-panel-${panel.id}\`` | presentation | Shows or hides a registered workspace panel. | 1073 |

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
