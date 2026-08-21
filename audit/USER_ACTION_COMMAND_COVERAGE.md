# User action / command coverage

Generated from the central editor menu on 2026-08-21. This is the first checked surface, not complete application coverage.

## Current measured surface

- 106 unique static executable menu actions plus 4 dynamic families;
- 52 already routed through semantic commands;
- 0 have a semantic command but still bypass it in this UI path;
- 21 host/workspace operations;
- 36 presentation-only operations;
- 1 genuine semantic command gaps;
- 4 checked dynamic menu families.

## Meaning

A command-owner entry has a catalog command and canonical implementation, but this UI path still calls the owner directly; an Actions recorder would therefore miss it. A gap means the user can perform the operation through the normal UI but the central semantic command catalog cannot yet express it. Host and presentation classifications are not automatically MCP edits, but still need an explicit agent product decision later.

## Menu inventory

| Menu action | Classification | Command or reason | Source line(s) |
| --- | --- | --- | --- |
| `about` | presentation | Opens application information; no document mutation. | 770 |
| `actual-size` | command | `view.setZoom` | 782 |
| `add-mask` | command | `layer.setMask` | 645 |
| `ai-history` | presentation | Shows the AI Assets panel. | 400 |
| `ai-provider-openart` | host | Changes an external provider connection. | 379 |
| `apply-auto-align` | command | `layer.autoAlign` | 705 |
| `assign-profile-srgb` | command | `document.assignProfile` | 351 |
| `auto-align` | presentation | Starts transient GPU analysis and compositor preview; Apply commits layer.autoAlign. | 715 |
| `cancel-auto-align` | presentation | Cancels transient analysis/preview without mutating document state. | 710 |
| `canvas-size` | command | `document.applyGeometry` | 519 |
| `clear-guides` | presentation | Changes document-view guides, not image content. | 853 |
| `clear-recent` | host | Changes host-maintained recent-file state. | 212 |
| `clear-recent-projects` | host | Changes host-maintained recent-project state. | 268 |
| `clear-selection` | command | `selection.modify` | 431 |
| `clipping-mask` | command | `layer.setClipping` | 628 |
| `close-project` | host | Changes host project lifecycle state. | 276 |
| `command-help` | presentation | Opens command documentation. | 762 |
| `convert-text-to-shape` | command | `text.convertToShape` | 667, 752 |
| `copy-grade` | command | `grade.copy` | 315 |
| `copy-merged-content` | command | `selection.copyPixels` | 301 |
| `copy-selected-content` | command | `selection.copyPixels` | 294 |
| `delete-layer` | command | `layer.delete` | 589 |
| `duplicate-image` | command | `document.duplicate` | 553 |
| `duplicate-layer` | command | `layer.duplicate` | 580 |
| `edit-layer-mask` | presentation | Changes the active editing channel. | 650 |
| `edit-layer-pixels` | presentation | Changes the active editing channel. | 635 |
| `exit-application` | host | Closes the desktop host application and belongs to host lifecycle control. | 282 |
| `export-jpeg` | host | Runs the local save/download flow; Actions and MCP use file.exportBitmap with the same codec owner. | 240 |
| `export-png-native` | host | Runs the local save/download flow; Actions and MCP use file.exportPng with the same renderer output. | 239 |
| `export-pdf` | host | Runs an interactive local PDF export flow. | 245 |
| `export-png` | host | Runs a local download flow distinct from file.exportPng artifact creation. | 227 |
| `export-psd` | host | Runs a local download flow distinct from file.exportPsd artifact creation. | 243 |
| `export-psd-appearance` | host | Runs an interactive maximum-appearance PSD export flow. | 244 |
| `export-tiff` | host | Runs the local save/download flow; Actions and MCP use file.exportBitmap with the same codec owner. | 242 |
| `export-webp` | host | Runs the local save/download flow; Actions and MCP use file.exportBitmap with the same codec owner. | 241 |
| `extras` | presentation | Toggles canvas overlays. | 807 |
| `feather-selection` | command | `selection.modify` | 442 |
| `fit` | command | `view.setZoom` | 775 |
| `flatten-group` | command | `layer.flattenGroup` | 736 |
| `flatten-image` | command | `document.flattenImage` | 742 |
| `flip-canvas-horizontal` | command | `document.applyGeometry` | 541 |
| `flip-canvas-vertical` | command | `document.applyGeometry` | 544 |
| `format-support` | presentation | Opens format-support information. | 246 |
| `guided-sample` | host | Starts an application-level guided workflow. | 763 |
| `image-crop` | command | `document.applyGeometry` | 548 |
| `image-rotation-180` | command | `document.applyGeometry` | 529 |
| `image-rotation-arbitrary` | command | `document.applyGeometry` | 538 |
| `image-rotation-clockwise-90` | command | `document.applyGeometry` | 532 |
| `image-rotation-counter-clockwise-90` | command | `document.applyGeometry` | 535 |
| `image-size` | command | `document.resizeImage` | 512 |
| `invert-layer-colors` | command | `raster.invert` | 614 |
| `invert-selection` | command | `selection.modify` | 424 |
| `layer-via-copy` | command | `layer.copyToNewLayer` | 572 |
| `lock-guides` | presentation | Changes document-view guide interaction. | 852 |
| `merge-down` | command | `layer.merge` | 728 |
| `move-down` | command | `layer.move` | 697 |
| `move-up` | command | `layer.move` | 692 |
| `new-document` | command | `document.create` | 182 |
| `new-guide` | presentation | Creates a document-view guide, not image content. | 851 |
| `new-layer` | command | `layer.createRaster` | 567 |
| `new-project` | host | Changes host project lifecycle state. | 249 |
| `open-image` | host | Uses a local file picker; file.openArtifact targets registered artifacts. | 189 |
| `open-project` | host | Uses a host project picker. | 256 |
| `paste-grade` | command | `grade.paste` | 322 |
| `paste-selected-content` | command | `selection.pastePixels` | 308 |
| `place-image` | host | Uses a local file picker before layer.placeArtifact can apply. | 196 |
| `rasterize-text` | command | `text.rasterize` | 676 |
| `remove-background` | command | `layer.removeBackground` | 457, 622 |
| `remove-mask` | command | `layer.setMask` | 660 |
| `remove-object` | gap | No semantic object-removal command exists. | 450 |
| `rename-layer` | command | `layer.rename` | 596 |
| `reset-workspace-layout` | presentation | Resets local panel layout. | 864 |
| `rulers` | presentation | Toggles canvas rulers. | 823 |
| `save-corrected` | host | Writes through the current source/host save workflow. | 220 |
| `select-all` | command | `selection.modify` | 410 |
| `select-none` | command | `selection.modify` | 417 |
| `settings` | presentation | Opens application preferences. | 364 |
| `show-actions-panel` | presentation | Shows the Actions panel. | 882 |
| `show-ai-history-panel` | presentation | Shows the AI Assets panel. | 877 |
| `show-debug-panel` | presentation | Shows the Debug panel. | 887 |
| `show-difference` | presentation | Toggles a diagnostic viewport comparison. | 789 |
| `show-genai-panel` | presentation | Shows the GenAI panel. | 872 |
| `show-grid` | presentation | Toggles the canvas grid. | 818 |
| `show-guides` | presentation | Toggles canvas guides. | 819 |
| `show-smart-guides` | presentation | Toggles smart guides. | 820 |
| `snap` | presentation | Changes local snapping behavior. | 829 |
| `snap-all` | presentation | Changes local snapping behavior. | 843 |
| `snap-document` | presentation | Changes local snapping behavior. | 842 |
| `snap-grid` | presentation | Changes local snapping behavior. | 840 |
| `snap-guides` | presentation | Changes local snapping behavior. | 839 |
| `snap-layers` | presentation | Changes local snapping behavior. | 841 |
| `snap-none` | presentation | Changes local snapping behavior. | 844 |
| `third-party-licenses` | presentation | Opens legal information. | 764 |
| `toggle-lock` | command | `layer.setLock` | 721 |
| `toggle-mask` | command | `layer.setMask` | 655 |
| `toggle-screen-mode` | presentation | Changes application window presentation. | 800 |
| `toggle-visibility` | command | `layer.setVisibility` | 682 |
| `transform-flip-horizontal` | command | `transform.applyFixed` | 340 |
| `transform-flip-vertical` | command | `transform.applyFixed` | 342 |
| `transform-rotate-180` | command | `transform.applyFixed` | 334 |
| `transform-rotate-clockwise-90` | command | `transform.applyFixed` | 336 |
| `transform-rotate-counter-clockwise-90` | command | `transform.applyFixed` | 338 |
| `ui-style-guide` | presentation | Opens the developer UI style guide. | 892 |
| `workspace-ai-generation` | presentation | Applies a local workspace layout preset. | 863 |
| `workspace-grading` | presentation | Applies a local workspace layout preset. | 862 |
| `workspace-photo-edit` | presentation | Applies a local workspace layout preset. | 861 |

## Dynamic menu families

| Value expression | Classification | Command or reason | Source line |
| --- | --- | --- | --- |
| `\`open-recent-${file.id}\`` | host | Opens a host-maintained local recent-file entry. | 207 |
| `\`open-recent-project-${project.recentId}\`` | host | Opens a host-maintained recent-project entry. | 262 |
| `\`image-adjustments-${definition.id}\`` | command | `adjustment.create` | 477 |
| `\`blend-${mode.id}\`` | command | `layer.setBlendMode` | 607 |

## Toolbar inventory

- 36 registered tools;
- 32 have a recorded UI/command route;
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
