# Lens Blur Improvements

This is the current implementation follow-up list. Move completed items to **Resolved** and remove superseded investigations rather than retaining a historical backlog as active work.

## Current Direction

The active renderer is the depth-aware foreground/background gather. It is the baseline because it preserves sharp foreground occlusion better than the experimental separable complex filter.

- Interaction: 24 samples.
- Final `balanced`: 48 samples.
- Final `high`: 64 samples, the default.
- Final `ultra`: 128 samples.

## Open

- **Depth-aware complex Circle filter:** do not re-enable the experimental complex route until it filters a background-only color layer and a matching confidence/weight layer. It must retain the gather foreground-occlusion result during final compositing; a global complex blur leaks background color through sharp foreground edges.
- **Depth-map quality validation:** inspect the raw normalized model map separately from the full-resolution refined map when artifacts are reported. The panel reports the returned model dimensions; the current Depth view shows the refined result.
- **CoC response tuning:** evaluate a smooth nonlinear depth-domain remap outside the sharp focus interval. Focus Range remains a zero-CoC plateau; Focus Feather controls soft transitions on both sides; Blur Amount scales the resulting physical radius.
- **Visual test set:** portrait hair, hard foreground crossings, isolated point lights, flat backgrounds, wide images, high Blur Amount, all aperture shapes and all final sample presets.

## Resolved

- Complex Circle output is no longer selected as an HQ default. It produced more edge feathering and bleed than the depth-aware gather.
- The gather no longer has one fixed 24-sample final quality. Final renders select 48, 64 or 128 samples by persisted quality, while interaction remains 24 samples.
- The gather now uses a deterministic per-pixel aperture rotation, source-sample CoC reach for background contributions, and the downsampled tile maximum depth to reject foreground-contaminated background samples.
- Model depth is bilinearly upsampled before guided refinement instead of nearest-neighbour sampled.