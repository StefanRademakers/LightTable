# Owner acceptance automation report — 6 August 2026

Historical status: automation passed for candidate `2643a94c`, but direct owner
sign-off did not occur before that candidate was superseded. This is reusable
procedure and historical evidence, not current release evidence.

The final packaged batch ran all 15 projects from
`test/acceptance/owner-workflows.json`. Every deterministic route passed after
correcting three acceptance-harness errors: the release smoke used an obsolete
ARIA role for editor menus, point-text was aimed at a document containing
existing text at its click coordinate, and raster merge was aimed at a document
without a tight raster pair. Focused reruns and the full rerun passed.

| Project | Automated status | Owner status |
| --- | --- | --- |
| Photo correction and export | pass | review required |
| Large layered invitation (EHS-396) | pass | review required |
| Point text creation/editing | pass | review required |
| Paragraph text and typography | pass | review required |
| Editable shapes and geometry | pass | review required |
| Gradient authoring | pass | review required |
| Layer effects editing | pass | review required |
| Painting, gesture and mask workflow | pass | review required |
| Transforms, rasterization and merge | pass | review required |
| Native save/reopen/crash recovery | pass | review required |
| Editable Photoshop roundtrip | pass | review required |
| PDF open/export corpus | pass: 12/12 | review required |
| MCP-created editable design | pass | review required |
| Accessibility and diagnostics | pass | review required |
| Generic command/artifact/undo roundtrip | pass | review required |

Run evidence is under `tmp/owner-acceptance/task-108-final/`: `report.json`,
`defects.json`, `owner-checklist.md` and per-project logs. Fixture-specific
screenshots and reports are linked from those logs and remain under established
`tmp/` smoke directories. Sources were neither modified nor uploaded.

There are zero open automation defects and no P0/P1 finding from this run. This
does not approve perceived latency or visual quality. The owner must execute the
recorded task for each project and sign the final three declarations in
`owner-checklist.md`. That sign-off was not recorded before the assessed
candidate was superseded.
