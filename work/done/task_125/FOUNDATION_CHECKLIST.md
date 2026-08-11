# Task 125 - Project foundation checklist

Scope: optional project management, deterministic filesystem structure and the
rebuildable asset catalog. `@asset` lookup and GenAI integration remain deferred
until this foundation is proven.

## Project contract

- [x] Define one current `project.ltproject` manifest contract.
- [x] Validate manifests strictly; malformed projects fail without changing workspace state.
- [x] Store project-internal folder mappings as normalized relative paths.
- [x] Resolve every logical storage location through one central resolver.
- [x] Reject absolute paths, traversal and escaping folder mappings.

## Desktop filesystem

- [x] Create a project transactionally through a temporary sibling directory.
- [x] Refuse to overwrite an existing file or directory.
- [x] Create all user-facing default folders.
- [x] Create disposable `.lighttable` cache, thumbnail, index and temp folders.
- [x] Add a `.lighttable/.gitignore` so generated internals stay out of source control.
- [x] Open and validate an existing project manifest.

## Application workflow

- [x] Keep standalone mode as the default and fully functional.
- [x] Add New Project, Open Project, Close Project and Recent Projects to File.
- [x] Add a minimal New Project dialog using canonical LightTable controls.
- [x] Keep open documents alive when a project opens or closes.
- [x] Maintain recent projects independently from recent documents.
- [x] Surface the active project subtly in the editor workspace.
- [x] Add canonical project-folder defaults to Preferences.
- [x] Keep AI renders, input, history and Trash visible on disk but system-managed.
- [x] Keep cache, thumbnails, indexes and temp fixed under `.lighttable`.
- [x] Apply the configured folder layout only when creating new projects.
- [x] Generate an aspect-preserving project thumbnail after an in-project save.
- [x] Upsert the saved document in a rebuildable project asset index.
- [x] Keep thumbnail/index work non-blocking and outside the save transaction.
- [x] Scan the full project root on open, including custom mappings and user folders.
- [x] Exclude internal `.lighttable`, the manifest, symlinks and Trash from scanning.
- [x] Watch active projects and debounce external filesystem changes.
- [x] Stop the watcher when a project closes or another project becomes active.
- [x] Reuse unchanged thumbnails and remove stale index entries/derived thumbnails.

## Verification

- [x] Unit-test manifest parsing and storage resolution.
- [x] Unit-test transactional creation and directory layout.
- [x] Unit-test recent-project MRU behavior.
- [x] Unit-test save-driven thumbnail persistence and index upserts.
- [x] Unit-test custom-folder discovery, Trash exclusion and deletion reconciliation.
- [x] Desktop smoke: create -> close -> reopen while multiple documents remain open.
- [x] Run focused app/desktop typechecks and boundary checks.

## Explicitly deferred

- `@asset` search UI/API.
- GenAI input/history/output storage adapters.
- Existing-project folder relinking or migration.
- Trash behavior, semantic metadata, tags, embeddings and templates.
