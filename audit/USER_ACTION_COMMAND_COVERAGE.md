# User action / command coverage

Generated from the central editor menu on 2026-08-20. This is the first checked surface, not complete application coverage.

## Current measured surface

- 103 unique static executable menu actions plus 4 dynamic families;
- 37 already routed through semantic commands;
- 0 have a semantic command but still bypass it in this UI path;
- 18 host/workspace operations;
- 34 presentation-only operations;
- 18 genuine semantic command gaps;
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
| `apply-auto-align` | gap | No semantic auto-align command exists. | 700 |
| `assign-profile-srgb` | gap | No semantic color-profile command exists. | 346 |
| `auto-align` | gap | No semantic auto-align command exists. | 710 |
| `cancel-auto-align` | gap | No semantic auto-align command exists. | 705 |
| `canvas-size` | command | `document.applyGeometry` | 514 |
| `clear-guides` | presentation | Changes document-view guides, not image content. | 848 |
| `clear-recent` | host | Changes host-maintained recent-file state. | 210 |
| `clear-recent-projects` | host | Changes host-maintained recent-project state. | 263 |
| `clear-selection` | command | `selection.modify` | 426 |
| `clipping-mask` | command | `layer.setClipping` | 623 |
| `close-project` | host | Changes host project lifecycle state. | 271 |
| `command-help` | presentation | Opens command documentation. | 757 |
| `convert-text-to-shape` | gap | No semantic text-to-shape command exists. | 662, 747 |
| `copy-grade` | gap | No semantic grade-clipboard command exists. | 310 |
| `copy-merged-content` | gap | No semantic pixel-clipboard command exists. | 296 |
| `copy-selected-content` | gap | No semantic pixel-clipboard command exists. | 289 |
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
| `feather-selection` | gap | No semantic selection-feather command exists. | 437 |
| `fit` | command | `view.setZoom` | 770 |
| `flatten-group` | gap | No semantic group-flatten command exists. | 731 |
| `flatten-image` | gap | No semantic image-flatten command exists. | 737 |
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
| `layer-via-copy` | gap | No semantic layer-via-copy command exists. | 567 |
| `lock-guides` | presentation | Changes document-view guide interaction. | 847 |
| `merge-down` | gap | No semantic layer-merge command exists. | 723 |
| `move-down` | command | `layer.move` | 692 |
| `move-up` | command | `layer.move` | 687 |
| `new-document` | command | `document.create` | 180 |
| `new-guide` | presentation | Creates a document-view guide, not image content. | 846 |
| `new-layer` | command | `layer.createRaster` | 562 |
| `new-project` | host | Changes host project lifecycle state. | 244 |
| `open-image` | host | Uses a local file picker; file.openArtifact targets registered artifacts. | 187 |
| `open-project` | host | Uses a host project picker. | 251 |
| `paste-grade` | gap | No semantic grade-clipboard command exists. | 317 |
| `paste-selected-content` | gap | No semantic pixel-clipboard command exists. | 303 |
| `place-image` | host | Uses a local file picker before layer.placeArtifact can apply. | 194 |
| `rasterize-text` | gap | No semantic text-rasterize command exists. | 671 |
| `remove-background` | gap | No semantic background-removal command exists. | 452, 617 |
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
