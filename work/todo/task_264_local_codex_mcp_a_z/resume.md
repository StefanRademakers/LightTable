# MCP / Actions autonomous-work resume checkpoint

Recorded: 2026-08-21
Repository baseline: `ff2fefdf` on `main`

## Why work stopped

The MCP/Actions program was paused at an owner-requested stable checkpoint so
the packaged application could be built and visually tested. Task 277 then
implemented native JPEG/PNG/WebP/TIFF Save, export and Windows Open With in the
current dirty worktree. Its packaged Windows flow is recorded as passing, while
macOS runtime qualification remains open. Subsequent owner testing added
several bounded desktop/editor fixes to that same uncommitted checkpoint.

Do not apply the stashed Task 276 Action-schema migration over this dirty tree.
First split, verify and commit the current bitmap/desktop/editor work into
coherent milestones, preserving the user's `.vscode/settings.json`.

## Last proven product state

- The shared UI -> semantic command -> Actions -> Agent Access/MCP architecture
  is established. Task 214 remains the active program owner; it is not complete.
- A local packaged LightTable/Codex route exists. `npm run mcp:local:codex`
  launches an isolated desktop and prints the opt-in Codex connection commands.
- `npm run smoke:mcp:local-codex` proved the external Streamable HTTP transport,
  approval lifecycle, bounded inspection/preview, edit denial under read-only,
  revocation and explicit edit escalation.
- A genuinely fresh Codex session has not yet completed the full artist flow.
  Task 264 therefore remains active.
- Task 276 implemented explicit per-command Action schema migrations and its
  focused evidence, but that complete change set is currently stashed and not
  part of `main`.
- The current `main` also contains the later committed Actions work through
  explicit atomic playback plus packaged-layout and first-document startup
  fixes. Do not regress those commits while restoring Task 276.
- Task 277's Windows implementation is present but uncommitted: native flat
  source Save for JPEG/PNG/WebP/TIFF, shared export codecs, cold/warm OS-open,
  Squirrel associations and installer flow. Its `task.txt` contains the exact
  packaged evidence and the remaining macOS qualification gap.
- Task 278 is an active research task only. The deterministic packaged renderer
  origin addresses duplicate origin-bound model downloads, but cross-model
  cache reuse, preparation phases, optimized artifacts and runtime lifecycle
  still require measurement; do not describe that research as implemented.
- Additional uncommitted owner-tested follow-ups include encoded clipboard
  preference/fallback diagnostics, empty-raster merge handling, Shift thumbnail
  range selection, per-active-workspace layout persistence, Grade Look ordering,
  application/installer icons and Windows titlebar integration. Treat each as a
  separate reviewable slice rather than folding it into Task 276.
- `.titlebar-verify/` is generated renderer-build output, not product source.
  Remove it only after resolving the exact verified path safely; never stage it.

Relevant committed MCP/Actions baseline, newest first:

```text
ff2fefdf fix(editor): retry first document after scope mount
38483383 fix(editor): enforce full-window packaged layout
05f10580 fix(launcher): group start navigation
af0a6a62 feat(actions): add explicit atomic playback
6b39a8b7 feat(actions): add bounded step rationales
b4f4db43 feat(actions): edit recorded steps from schemas
ebc2ce9c feat(actions): add typed workflow bindings
ab7d9daa feat(actions): add durable named action sets
```

## Recoverable uncommitted work

Two stashes exist. Refer to their immutable hashes because stash indexes change
when another stash is created.

1. Full/latest checkpoint
   Hash: `4f7ac4e4b09d467f25e4e5e9bd12b2ed0b41f3ca`
   Label: `wip task 276 and relocated external fixtures`

   This is the continuation source. It contains the Action schema-migration
   implementation/tests, Task 276 completion record, related architecture and
   acceptance truth updates, and mechanical updates to desktop smoke scripts
   after the owner's fixture relocation.

2. Earlier/narrow checkpoint
   Hash: `20a3303a10cb23cb57e98d3c200060983e14e806`
   Label: `wip task 276 action schema migrations`

   This is only an earlier safety checkpoint. It modifies
   `actionCommandContracts.ts` and adds the initial migration implementation and
   todo record. Do not apply it after the full checkpoint.

The full stash includes untracked files that ordinary `git stash show --stat`
does not display unless `--include-untracked` is supplied. Inspect with:

```powershell
git stash show --include-untracked --name-status 4f7ac4e4b09d467f25e4e5e9bd12b2ed0b41f3ca
```

## Safe continuation sequence

1. Re-run `npm run context:agent`. Its live output now reports recent commits,
   immutable stash hashes, this resume checkpoint and malformed/duplicate queue
   directories; do not count directories without `task.txt` as active work.
2. Audit the current dirty paths into coherent ownership groups. Finish or
   explicitly checkpoint Task 277 first, then review the later UI/desktop fixes
   separately. Do not stage `.vscode/settings.json` or `.titlebar-verify/`.
3. After those groups are committed or deliberately stashed, inspect the full
   Task 276 stash by immutable hash. Apply it without dropping it:

   ```powershell
   git stash apply 4f7ac4e4b09d467f25e4e5e9bd12b2ed0b41f3ca
   ```

4. Resolve conflicts semantically. Architecture files such as `QUICKSTART.md`
   and `CURRENT_STATE_AND_ROADMAP.md` may also have moved during Task 277; retain
   both the newer bitmap truth and the Task 276 migration truth. Do not accept
   either side wholesale.
5. Confirm the two new implementation files are present:

   ```text
   packages/lighttable-app/src/lighttable/application/actions/actionCommandSchemaMigrations.ts
   packages/lighttable-app/src/lighttable/application/actions/actionCommandSchemaMigrations.test.ts
   ```

6. Re-run the Task 276 focused Actions tests, app typecheck and repository
   boundary/architecture checks named by the current package scripts. Inspect
   the task's recorded evidence; do not rely on its old green result after a
   conflict resolution.
7. Review the broad script/fixture-path edits separately. The owner moved test
   files from `D:\` to `D:\mediavibe\LightTableTestFiles\RandomFiles`. Keep
   external paths configurable and never commit the private fixture bytes.
8. Commit Task 276 alone with a focused migration message. Only then drop the
   two safety stashes if the committed tree contains all intended changes and
   the owner no longer needs the earlier recovery point.
9. Resume Task 264 using
   `architecture/integrations/LOCAL_CODEX_MCP_ACCEPTANCE.md` and perform the
   fresh-session acceptance below.

## Remaining Task 264 acceptance

The next autonomous product proof is one connected, representative flow through
a fresh Codex MCP client:

1. Launch the packaged isolated app with `npm run mcp:local:codex`.
2. Register/login the printed local MCP endpoint, then start a genuinely fresh
   Codex session.
3. Grant only read first; inspect workspace, documents, layers, capabilities,
   current-layer content and a bounded revision-bound preview.
4. Prove an edit is denied under read-only. Grant edit deliberately.
5. Create a document and construct a small editable layered composition using
   semantic commands—not UI selectors or implementation-specific model names.
6. Inspect events/revisions and rendered output, correct a visible problem, and
   save/export through the supported artifact route.
7. Independently query/inspect the final editable layer state and rendered
   pixels through the packaged automation/query route.
8. Exercise invalid schema, stale revision, missing target, disconnect/reconnect,
   cancellation and clean shutdown.
9. Remove the opt-in Codex MCP registration and verify no credentials, pairing
   codes, image bytes or private paths entered tracked files/reports.

## Guardrails when continuing capability coverage

- Expose stable artist intent, never current implementation detail. For example,
  MCP knows `selection.selectSubject`; it must not know SAM 2.1 or a replaceable
  model/backend identity.
- UI, Actions and MCP share the same canonical executor. A second remote-only
  mutation path is a regression even when its output looks correct.
- High-frequency paint, warp, transform and slider previews remain local and
  frame-coalesced. Remote calls carry final bounded recipes/values and one
  semantic history commit, not pointer samples or simulated slider motion.
- Observation is bounded and on demand: structured layer/document queries plus
  revision-bound compressed previews. Never stream full images continuously.
- Command existence does not imply MCP admission. Permissions, schemas,
  revision/stale handling, bounded payloads and real packaged evidence remain
  required.
- Remove Object remains intentionally outside this continuation until its
  internal product owner is ready.

## Definition of the next stable checkpoint

The current dirty checkpoint is stable only after Task 277 and the later
desktop/editor fixes have been separated, verified and committed without user
settings or generated output. The MCP continuation then reaches its next stable
checkpoint only when Task 276 is a verified focused commit and the fresh-Codex
flow has independently proven both editable state and final pixels. Tool counts,
schema counts and an MCP connection by themselves are not completion evidence.
