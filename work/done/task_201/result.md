# Task 201 result

Completed on 2026-08-20.

## Outcome

- Restored the missing Image Size layout rules that were accidentally removed
  in commit `5b7febec` during a broad stylesheet cleanup.
- Retained the current shared `FormSelect`, `NumericExpressionInput`,
  `SwitchControl`, `ActionButton` and modal primitives.
- Added a narrow-viewport layout so the dialog does not depend on the desktop
  three-column arrangement when horizontal space is unavailable.
- Extended the existing packaged desktop smoke to fail when the dialog width,
  body grid or label column disappears again.
- Corrected the smoke's obsolete compact-select expectation to the current
  canonical form-control dimensions.

## Verification

- `npm run typecheck -w @lighttable/app`
- `npm run audit:ui-boundary`
- `npm run package:desktop:verify`
- `npm run smoke:desktop:image-size`

All passed. The smoke exercised the real packaged application, opened Image
Size through its keyboard route, captured the dialog, resized linked
dimensions, verified editable layer semantics, tested UI and command execution,
and verified normal and immediate undo.

Visual evidence:

- `tmp/image-size-smoke/shapes/image-size.png`
- `tmp/image-size-smoke/shapes/image-size-resized.png`
- `tmp/image-size-smoke/shapes/image-size.json`
