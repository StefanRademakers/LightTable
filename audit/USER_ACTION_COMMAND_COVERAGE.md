# User action / command coverage

Generated from the central editor menu on 2026-08-19. This is the first checked surface, not complete application coverage.

## Current measured surface

- 102 unique static executable menu actions plus 4 dynamic families;
- 16 already routed through semantic commands;
- 0 have a semantic command but still bypass it in this UI path;
- 17 host/workspace operations;
- 34 presentation-only operations;
- 39 genuine semantic command gaps;
- 4 checked dynamic menu families.

## Meaning

A command-owner entry has a catalog command and canonical implementation, but this UI path still calls the owner directly; an Actions recorder would therefore miss it. A gap means the user can perform the operation through the normal UI but the central semantic command catalog cannot yet express it. Host and presentation classifications are not automatically MCP edits, but still need an explicit agent product decision later.

## Menu inventory

| Menu action | Classification | Command or reason | Source line(s) |
| --- | --- | --- | --- |
| `about` | presentation | Opens application information; no document mutation. | 738 |
| `actual-size` | command | `view.setZoom` | 750 |
| `add-mask` | gap | No semantic layer-mask command exists. | 645 |
| `ai-history` | presentation | Shows the AI Assets panel. | 387 |
| `ai-provider-openart` | host | Changes an external provider connection. | 366 |
| `apply-auto-align` | gap | No semantic auto-align command exists. | 597 |
| `assign-profile-srgb` | gap | No semantic color-profile command exists. | 338 |
| `auto-align` | gap | No semantic auto-align command exists. | 608 |
| `cancel-auto-align` | gap | No semantic auto-align command exists. | 603 |
| `canvas-size` | command | `document.applyGeometry` | 474 |
| `clear-guides` | presentation | Changes document-view guides, not image content. | 810 |
| `clear-recent` | host | Changes host-maintained recent-file state. | 209 |
| `clear-recent-projects` | host | Changes host-maintained recent-project state. | 262 |
| `clear-selection` | gap | No semantic selection command exists. | 418 |
| `clipping-mask` | gap | No semantic clipping-mask command exists. | 615 |
| `close-project` | host | Changes host project lifecycle state. | 270 |
| `command-help` | presentation | Opens command documentation. | 730 |
| `convert-text-to-shape` | gap | No semantic text-to-shape command exists. | 559, 720 |
| `copy-grade` | gap | No semantic grade-clipboard command exists. | 302 |
| `copy-merged-content` | gap | No semantic pixel-clipboard command exists. | 288 |
| `copy-selected-content` | gap | No semantic pixel-clipboard command exists. | 281 |
| `delete-layer` | gap | No semantic layer-delete command exists. | 709 |
| `duplicate-image` | command | `document.duplicate` | 536 |
| `duplicate-layer` | gap | No semantic layer-duplicate command exists. | 553 |
| `edit-layer-mask` | presentation | Changes the active editing channel. | 639 |
| `edit-layer-pixels` | presentation | Changes the active editing channel. | 633 |
| `export-jpeg` | host | Runs a local download flow; no JPEG artifact command exists. | 236 |
| `export-pdf` | host | Runs an interactive local PDF export flow. | 239 |
| `export-png` | host | Runs a local download flow distinct from file.exportPng artifact creation. | 224 |
| `export-psd` | host | Runs a local download flow distinct from file.exportPsd artifact creation. | 237 |
| `export-psd-appearance` | host | Runs an interactive maximum-appearance PSD export flow. | 238 |
| `extras` | presentation | Toggles canvas overlays. | 764 |
| `feather-selection` | gap | No semantic selection-feather command exists. | 425 |
| `fit` | command | `view.setZoom` | 743 |
| `flatten-group` | gap | No semantic group-flatten command exists. | 684 |
| `flatten-image` | gap | No semantic image-flatten command exists. | 690 |
| `flip-canvas-horizontal` | command | `document.applyGeometry` | 496 |
| `flip-canvas-vertical` | command | `document.applyGeometry` | 499 |
| `format-support` | presentation | Opens format-support information. | 240 |
| `guided-sample` | host | Starts an application-level guided workflow. | 731 |
| `image-crop` | command | `document.applyGeometry` | 503 |
| `image-rotation-180` | command | `document.applyGeometry` | 484 |
| `image-rotation-arbitrary` | command | `document.applyGeometry` | 493 |
| `image-rotation-clockwise-90` | command | `document.applyGeometry` | 487 |
| `image-rotation-counter-clockwise-90` | command | `document.applyGeometry` | 490 |
| `image-size` | command | `document.resizeImage` | 468 |
| `invert-layer-colors` | gap | No semantic raster-invert command exists. | 582 |
| `invert-selection` | gap | No semantic selection command exists. | 411 |
| `layer-via-copy` | gap | No semantic layer-via-copy command exists. | 569 |
| `lock-guides` | presentation | Changes document-view guide interaction. | 809 |
| `merge-down` | gap | No semantic layer-merge command exists. | 677 |
| `move-down` | gap | No semantic layer-order command exists. | 671 |
| `move-up` | gap | No semantic layer-order command exists. | 664 |
| `new-document` | command | `document.create` | 179 |
| `new-guide` | presentation | Creates a document-view guide, not image content. | 808 |
| `new-layer` | command | `layer.createRaster` | 547 |
| `new-project` | host | Changes host project lifecycle state. | 243 |
| `open-image` | host | Uses a local file picker; file.openArtifact targets registered artifacts. | 186 |
| `open-project` | host | Uses a host project picker. | 250 |
| `paste-grade` | gap | No semantic grade-clipboard command exists. | 309 |
| `paste-selected-content` | gap | No semantic pixel-clipboard command exists. | 295 |
| `place-image` | host | Uses a local file picker before layer.placeArtifact can apply. | 193 |
| `rasterize-text` | gap | No semantic text-rasterize command exists. | 564 |
| `remove-background` | gap | No semantic background-removal command exists. | 440, 590 |
| `remove-mask` | gap | No semantic layer-mask command exists. | 658 |
| `remove-object` | gap | No semantic object-removal command exists. | 433 |
| `rename-layer` | command | `layer.rename` | 576 |
| `reset-workspace-layout` | presentation | Resets local panel layout. | 821 |
| `rulers` | presentation | Toggles canvas rulers. | 771 |
| `save-corrected` | host | Writes through the current source/host save workflow. | 217 |
| `select-all` | gap | No semantic selection command exists. | 397 |
| `select-none` | gap | No semantic selection command exists. | 404 |
| `settings` | presentation | Opens application preferences. | 351 |
| `show-actions-panel` | presentation | Shows the Actions panel. | 839 |
| `show-ai-history-panel` | presentation | Shows the AI Assets panel. | 834 |
| `show-debug-panel` | presentation | Shows the Debug panel. | 844 |
| `show-difference` | presentation | Toggles a diagnostic viewport comparison. | 757 |
| `show-genai-panel` | presentation | Shows the GenAI panel. | 829 |
| `show-grid` | presentation | Toggles the canvas grid. | 799 |
| `show-guides` | presentation | Toggles canvas guides. | 800 |
| `show-smart-guides` | presentation | Toggles smart guides. | 801 |
| `snap` | presentation | Changes local snapping behavior. | 777 |
| `snap-all` | presentation | Changes local snapping behavior. | 791 |
| `snap-document` | presentation | Changes local snapping behavior. | 790 |
| `snap-grid` | presentation | Changes local snapping behavior. | 788 |
| `snap-guides` | presentation | Changes local snapping behavior. | 787 |
| `snap-layers` | presentation | Changes local snapping behavior. | 789 |
| `snap-none` | presentation | Changes local snapping behavior. | 792 |
| `third-party-licenses` | presentation | Opens legal information. | 732 |
| `toggle-lock` | gap | No semantic layer-lock command exists. | 703 |
| `toggle-mask` | gap | No semantic layer-mask command exists. | 652 |
| `toggle-screen-mode` | presentation | Changes application window presentation. | 854 |
| `toggle-visibility` | command | `layer.setVisibility` | 696 |
| `transform-flip-horizontal` | gap | No semantic layer/selection transform command exists. | 327 |
| `transform-flip-vertical` | gap | No semantic layer/selection transform command exists. | 329 |
| `transform-rotate-180` | gap | No semantic layer/selection transform command exists. | 321 |
| `transform-rotate-clockwise-90` | gap | No semantic layer/selection transform command exists. | 323 |
| `transform-rotate-counter-clockwise-90` | gap | No semantic layer/selection transform command exists. | 325 |
| `ui-style-guide` | presentation | Opens the developer UI style guide. | 849 |
| `workspace-ai-generation` | presentation | Applies a local workspace layout preset. | 820 |
| `workspace-grading` | presentation | Applies a local workspace layout preset. | 819 |
| `workspace-photo-edit` | presentation | Applies a local workspace layout preset. | 818 |

## Dynamic menu families

| Value expression | Classification | Command or reason | Source line |
| --- | --- | --- | --- |
| `\`open-recent-${file.id}\`` | host | Opens a host-maintained local recent-file entry. | 204 |
| `\`open-recent-project-${project.recentId}\`` | host | Opens a host-maintained recent-project entry. | 256 |
| `\`image-adjustments-${definition.id}\`` | gap | Adjustment-layer creation is not represented by a semantic command. | 460 |
| `\`blend-${mode.id}\`` | gap | Layer blend mode is not represented by a semantic command. | 626 |
