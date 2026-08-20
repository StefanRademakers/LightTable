# User action / command coverage

Generated from the central editor menu on 2026-08-20. This is the first checked surface, not complete application coverage.

## Current measured surface

- 103 unique static executable menu actions plus 4 dynamic families;
- 52 already routed through semantic commands;
- 0 have a semantic command but still bypass it in this UI path;
- 18 host/workspace operations;
- 36 presentation-only operations;
- 1 genuine semantic command gaps;
- 4 checked dynamic menu families.

## Meaning

A command-owner entry has a catalog command and canonical implementation, but this UI path still calls the owner directly; an Actions recorder would therefore miss it. A gap means the user can perform the operation through the normal UI but the central semantic command catalog cannot yet express it. Host and presentation classifications are not automatically MCP edits, but still need an explicit agent product decision later.

## Menu inventory

| Menu action | Classification | Command or reason | Source line(s) |
| --- | --- | --- | --- |
| `about` | presentation | Opens application information; no document mutation. | 765 |
| `actual-size` | command | `view.setZoom` | 777 |
| `add-mask` | command | `layer.setMask` | 640 |
| `ai-history` | presentation | Shows the AI Assets panel. | 395 |
| `ai-provider-openart` | host | Changes an external provider connection. | 374 |
| `apply-auto-align` | command | `layer.autoAlign` | 700 |
| `assign-profile-srgb` | command | `document.assignProfile` | 346 |
| `auto-align` | presentation | Starts transient GPU analysis and compositor preview; Apply commits layer.autoAlign. | 710 |
| `cancel-auto-align` | presentation | Cancels transient analysis/preview without mutating document state. | 705 |
| `canvas-size` | command | `document.applyGeometry` | 514 |
| `clear-guides` | presentation | Changes document-view guides, not image content. | 848 |
| `clear-recent` | host | Changes host-maintained recent-file state. | 210 |
| `clear-recent-projects` | host | Changes host-maintained recent-project state. | 263 |
| `clear-selection` | command | `selection.modify` | 426 |
| `clipping-mask` | command | `layer.setClipping` | 623 |
| `close-project` | host | Changes host project lifecycle state. | 271 |
| `command-help` | presentation | Opens command documentation. | 757 |
| `convert-text-to-shape` | command | `text.convertToShape` | 662, 747 |
| `copy-grade` | command | `grade.copy` | 310 |
| `copy-merged-content` | command | `selection.copyPixels` | 296 |
| `copy-selected-content` | command | `selection.copyPixels` | 289 |
| `delete-layer` | command | `layer.delete` | 584 |
| `duplicate-image` | command | `document.duplicate` | 548 |
| `duplicate-layer` | command | `layer.duplicate` | 575 |
| `edit-layer-mask` | presentation | Changes the active editing channel. | 645 |
| `edit-layer-pixels` | presentation | Changes the active editing channel. | 630 |
| `exit-application` | host | Closes the desktop host application and belongs to host lifecycle control. | 277 |
| `export-jpeg` | host | Runs a local download flow; no JPEG artifact command exists. | 237 |
| `export-pdf` | host | Runs an interactive local PDF export flow. | 240 |
| `export-png` | host | Runs a local download flow distinct from file.exportPng artifact creation. | 225 |
| `export-psd` | host | Runs a local download flow distinct from file.exportPsd artifact creation. | 238 |
| `export-psd-appearance` | host | Runs an interactive maximum-appearance PSD export flow. | 239 |
| `extras` | presentation | Toggles canvas overlays. | 802 |
| `feather-selection` | command | `selection.modify` | 437 |
| `fit` | command | `view.setZoom` | 770 |
| `flatten-group` | command | `layer.flattenGroup` | 731 |
| `flatten-image` | command | `document.flattenImage` | 737 |
| `flip-canvas-horizontal` | command | `document.applyGeometry` | 536 |
| `flip-canvas-vertical` | command | `document.applyGeometry` | 539 |
| `format-support` | presentation | Opens format-support information. | 241 |
| `guided-sample` | host | Starts an application-level guided workflow. | 758 |
| `image-crop` | command | `document.applyGeometry` | 543 |
| `image-rotation-180` | command | `document.applyGeometry` | 524 |
| `image-rotation-arbitrary` | command | `document.applyGeometry` | 533 |
| `image-rotation-clockwise-90` | command | `document.applyGeometry` | 527 |
| `image-rotation-counter-clockwise-90` | command | `document.applyGeometry` | 530 |
| `image-size` | command | `document.resizeImage` | 507 |
| `invert-layer-colors` | command | `raster.invert` | 609 |
| `invert-selection` | command | `selection.modify` | 419 |
| `layer-via-copy` | command | `layer.copyToNewLayer` | 567 |
| `lock-guides` | presentation | Changes document-view guide interaction. | 847 |
| `merge-down` | command | `layer.merge` | 723 |
| `move-down` | command | `layer.move` | 692 |
| `move-up` | command | `layer.move` | 687 |
| `new-document` | command | `document.create` | 180 |
| `new-guide` | presentation | Creates a document-view guide, not image content. | 846 |
| `new-layer` | command | `layer.createRaster` | 562 |
| `new-project` | host | Changes host project lifecycle state. | 244 |
| `open-image` | host | Uses a local file picker; file.openArtifact targets registered artifacts. | 187 |
| `open-project` | host | Uses a host project picker. | 251 |
| `paste-grade` | command | `grade.paste` | 317 |
| `paste-selected-content` | command | `selection.pastePixels` | 303 |
| `place-image` | host | Uses a local file picker before layer.placeArtifact can apply. | 194 |
| `rasterize-text` | command | `text.rasterize` | 671 |
| `remove-background` | command | `layer.removeBackground` | 452, 617 |
| `remove-mask` | command | `layer.setMask` | 655 |
| `remove-object` | gap | No semantic object-removal command exists. | 445 |
| `rename-layer` | command | `layer.rename` | 591 |
| `reset-workspace-layout` | presentation | Resets local panel layout. | 859 |
| `rulers` | presentation | Toggles canvas rulers. | 818 |
| `save-corrected` | host | Writes through the current source/host save workflow. | 218 |
| `select-all` | command | `selection.modify` | 405 |
| `select-none` | command | `selection.modify` | 412 |
| `settings` | presentation | Opens application preferences. | 359 |
| `show-actions-panel` | presentation | Shows the Actions panel. | 877 |
| `show-ai-history-panel` | presentation | Shows the AI Assets panel. | 872 |
| `show-debug-panel` | presentation | Shows the Debug panel. | 882 |
| `show-difference` | presentation | Toggles a diagnostic viewport comparison. | 784 |
| `show-genai-panel` | presentation | Shows the GenAI panel. | 867 |
| `show-grid` | presentation | Toggles the canvas grid. | 813 |
| `show-guides` | presentation | Toggles canvas guides. | 814 |
| `show-smart-guides` | presentation | Toggles smart guides. | 815 |
| `snap` | presentation | Changes local snapping behavior. | 824 |
| `snap-all` | presentation | Changes local snapping behavior. | 838 |
| `snap-document` | presentation | Changes local snapping behavior. | 837 |
| `snap-grid` | presentation | Changes local snapping behavior. | 835 |
| `snap-guides` | presentation | Changes local snapping behavior. | 834 |
| `snap-layers` | presentation | Changes local snapping behavior. | 836 |
| `snap-none` | presentation | Changes local snapping behavior. | 839 |
| `third-party-licenses` | presentation | Opens legal information. | 759 |
| `toggle-lock` | command | `layer.setLock` | 716 |
| `toggle-mask` | command | `layer.setMask` | 650 |
| `toggle-screen-mode` | presentation | Changes application window presentation. | 795 |
| `toggle-visibility` | command | `layer.setVisibility` | 677 |
| `transform-flip-horizontal` | command | `transform.applyFixed` | 335 |
| `transform-flip-vertical` | command | `transform.applyFixed` | 337 |
| `transform-rotate-180` | command | `transform.applyFixed` | 329 |
| `transform-rotate-clockwise-90` | command | `transform.applyFixed` | 331 |
| `transform-rotate-counter-clockwise-90` | command | `transform.applyFixed` | 333 |
| `ui-style-guide` | presentation | Opens the developer UI style guide. | 887 |
| `workspace-ai-generation` | presentation | Applies a local workspace layout preset. | 858 |
| `workspace-grading` | presentation | Applies a local workspace layout preset. | 857 |
| `workspace-photo-edit` | presentation | Applies a local workspace layout preset. | 856 |

## Dynamic menu families

| Value expression | Classification | Command or reason | Source line |
| --- | --- | --- | --- |
| `\`open-recent-${file.id}\`` | host | Opens a host-maintained local recent-file entry. | 205 |
| `\`open-recent-project-${project.recentId}\`` | host | Opens a host-maintained recent-project entry. | 257 |
| `\`image-adjustments-${definition.id}\`` | command | `adjustment.create` | 472 |
| `\`blend-${mode.id}\`` | command | `layer.setBlendMode` | 602 |

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
