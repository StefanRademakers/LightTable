# Task416 current checkpoint — 2026-09-12

O06j Grade clipboard binding is committed as `f1dc6ce3`. O07g Tool Options
composition is committed as `571df946`. O07h document-scopes presentation is
accepted in the current worktree and awaits its checkpoint commit.
Preserve unrelated untracked `work/recovered/`. No push requested.

## Accepted result

- One route: UI/Actions/MCP `grade.copy` prepares an exact mounted capture; the
  semantic handler validates complete LUT ownership and registers the artifact;
  only then does the binding publish the shared browser clipboard.
- UI Paste reads the current shared capture at invocation. It may reuse only a
  live artifact owned by the same handler. Evicted/persisted/foreign captures are
  registered without creating another Copy event. A clipboard-replacement race
  releases its unpublished artifact and does not dispatch Paste.
- Root `latestGradeClipboardArtifactRef`, inline capture/apply policy and the
  orphan `createAdjustmentCommands.copyGrade` route are deleted. Boundary checks
  forbid their return. `GradeAssetCommandService` remains mutation/import owner.
- Independent final critic: ACCEPT, no P0-P2 findings. Focused run PASS:
  1,003 tests/58 files, app typecheck, boundary and diff checks.
- Fresh instrumented package SHA256:
  `962af9c887214209d34c1aa38215dfb702d6997f084c83e081406c65c832d6ef`.
  Freshness smoke `tmp/grade-clipboard-freshness-smoke/run-fqtM2s` PASS with no
  page errors. Existing full Grade Look UI/Actions/MCP/LUT/rebind smoke PASS.
- Overlay 4,996 -> 4,941 physical lines; hard ceiling becomes 4,942.
  WebGpuEngine remains 4,003. Whole O07/O08 and whole-app acceptance remain open.

## O07g accepted result

- Overlay assembles one typed Tool Options feature projection. A pure 18-line
  helper adds only toolbar Gradient request and context-menu close/Warp reset.
  Shell forwards that contract and retains its independent vertical-toolbar
  inputs. No state, lifecycle, queue, service or domain policy was added.
- Critic ACCEPT, no P0-P2. 502 tests/56 files, typecheck, boundary and diff PASS.
  Fresh packaged PSD Shape family switch, Escape and Warp reset/close PASS with
  zero page errors: `tmp/tool-options-composition-smoke/report.json`.
- Package SHA256:
  `96839acf57859ed2d3552606cb922171a83f2810e96b4f61e47018a7ec7af7de`.
  Overlay 4,941 -> 4,866 (ceiling 4,867), Shell 388 -> 152, overlay host 43 -> 34.

## Next bounded slice

O07h removes the duplicate React/ref sources for scope settings and visibility,
plus the root histogram scheduler. `DocumentScopesPresentation` is the one
synchronous UI-projection owner; the renderer still owns GPU scope resources.
Focused tests, typecheck, boundary/source audits and fresh packaged scope
visibility/workspace wake pass. Package executable SHA256:
`1515b88b2839b0806c22d46f4b238b60ba5c1f47bae07eebd718b9dea39581e7`.
Overlay is 4,843 physical lines (ceiling 4,844); WebGpuEngine remains 4,003.

Next, perform O08 as a bounded endpoint authority scan before any further
extraction. Do not start WebGpuEngine decomposition under the current usage cap.
