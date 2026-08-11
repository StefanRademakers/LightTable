# LightTable Project System

## Goal

Add an optional **Project workflow** to LightTable.

Projects must make file management, GenAI assets, generated renders, references, caches, and reusable project assets predictable and organized.

A project is **optional**.

LightTable must continue to work normally without a project, like a traditional image editor:

- Open files from anywhere
- Create new documents
- Save / Save As anywhere
- Use LightTable without creating or opening a project

When a project is active, LightTable gains a structured storage and asset context.

---

# 1. Core Principle

LightTable supports two equal workflows:

## Standalone Mode

No project is active.

Typical behavior:

- Open arbitrary files from disk
- Save and Save As anywhere
- New documents do not require a project
- GenAI can still be used
- Temporary / generated AI data uses a configurable global/default location
- Project-specific `@asset` lookup is unavailable or uses a future global asset library

## Project Mode

A project is active.

Typical behavior:

- Project-specific storage locations become available
- Save/Open dialogs may default to the current project
- GenAI references are stored in the project
- AI renders and generation history are stored in the project
- Project assets can be searched from prompts
- Cache and thumbnail data can live inside the project
- File-system changes inside asset folders are automatically indexed

The editor itself should remain largely unaware of whether a project is active.

---

# 2. Default Project Structure

Initial default:

```text
MyProject/
├─ project.ltproject
│
├─ AiRenders/
│  ├─ History/
│  └─ Input/
│
├─ Characters/
├─ Props/
├─ Environments/
├─ Sets/
├─ Trash/
│
└─ .lighttable/
   ├─ cache/
   ├─ thumbnails/
   ├─ indexes/
   └─ temp/
```

## User-facing folders

### `AiRenders/`

Generated AI-related content.

#### `AiRenders/History/`

Persistent generation history.

Can contain:

- generated images
- generated video later
- generation metadata
- prompt history
- references to source assets
- model/provider information
- seed, dimensions, settings, etc.

A generation may eventually use a sidecar metadata file:

```text
AiRenders/History/
├─ 2026-08-11_153500_a83f.png
└─ 2026-08-11_153500_a83f.json
```

Do not make this exact naming scheme mandatory yet.

---

### `AiRenders/Input/`

Stores input files introduced through GenAI workflows.

Examples:

- pasted images in the Visual References box
- dropped images
- clipboard images
- imported reference images
- temporary source images that need to remain reproducible

Important:

Once an input is accepted into a project generation workflow, avoid depending on OS temp files or clipboard memory.

Persist the relevant source into the project where practical.

---

### `Characters/`

Reusable character assets.

Initially this is simply a normal directory.

Later it may gain semantic meaning such as:

- character identity
- reference sets
- turnaround images
- poses
- LoRA/model associations
- metadata
- tagging

Do not require this semantic layer in the first implementation.

---

### `Props/`

Reusable objects and prop assets.

Initially file-system based only.

---

### `Environments/`

Environment/location/background assets.

Initially file-system based only.

---

### `Sets/`

Reusable scene/set assets.

Initially file-system based only.

---

### `Trash/`

Project-local trash/recovery location.

This can later be used for soft-delete operations instead of immediately destroying project-managed assets.

Exact trash behavior can be implemented later.

---

# 3. Internal LightTable Folder

Use a hidden internal directory:

```text
.lighttable/
```

Default contents:

```text
.lighttable/
├─ cache/
├─ thumbnails/
├─ indexes/
└─ temp/
```

This keeps implementation details out of the user-facing project folders.

## `cache/`

Project-specific cached data.

Examples:

- derived previews
- decoded intermediates
- AI-related cached representations
- reusable computational results

Caches must always be safe to regenerate.

Do not store unique user content only in cache.

## `thumbnails/`

Generated asset/document thumbnails.

## `indexes/`

Persisted project asset indexes if useful.

The actual index format is implementation-defined.

## `temp/`

Project-scoped temporary data.

Anything stored here should be disposable.

---

# 4. Configurable Directory Layout

The directory structure above is the **default**, not a hard-coded permanent layout.

Users must eventually be able to configure the project directory mappings in:

```text
Preferences
  → Projects
```

Suggested settings:

```text
AI Renders        AiRenders
AI History        AiRenders/History
AI Input          AiRenders/Input
Characters        Characters
Props             Props
Environments      Environments
Sets              Sets
Trash             Trash

Internal Cache    .lighttable/cache
Thumbnails        .lighttable/thumbnails
Indexes           .lighttable/indexes
Temp              .lighttable/temp
```

Important architectural requirement:

Feature code must NOT construct these paths manually.

Avoid:

```ts
path.join(projectRoot, "AiRenders", "History")
```

throughout the application.

Instead use logical storage identifiers resolved by a centralized service.

Example:

```ts
enum ProjectStorageLocation {
  AiRenders,
  AiHistory,
  AiInput,
  Characters,
  Props,
  Environments,
  Sets,
  Trash,
  Cache,
  Thumbnails,
  Indexes,
  Temp,
}
```

Example usage:

```ts
projectStorage.resolve(ProjectStorageLocation.AiHistory)
```

This allows folder names and locations to be changed later without rewriting feature code.

---

# 5. Project Manifest

Each project should contain a small project manifest:

```text
project.ltproject
```

Prefer a readable, versioned format such as JSON.

Example concept:

```json
{
  "format": "lighttable-project",
  "version": 1,
  "id": "project-uuid",
  "name": "My Project",
  "createdAt": "2026-08-11T13:00:00Z",
  "folders": {
    "aiRenders": "AiRenders",
    "aiHistory": "AiRenders/History",
    "aiInput": "AiRenders/Input",
    "characters": "Characters",
    "props": "Props",
    "environments": "Environments",
    "sets": "Sets",
    "trash": "Trash"
  }
}
```

This is illustrative, not a required final schema.

## Manifest responsibilities

The project manifest may eventually contain:

- project ID
- project display name
- format version
- directory mappings
- project settings
- GenAI preferences
- metadata versioning
- future workspace preferences

Do not store the complete asset library inside the manifest.

The filesystem should remain usable and understandable independently.

---

# 6. Filesystem-First Design

Prefer a **filesystem-first** project model.

The project folder is the primary source of truth for assets.

Benefits:

- users can add files manually
- users can copy/move folders with Explorer/Finder
- projects remain understandable outside LightTable
- backup tools work normally
- NAS storage remains practical
- external applications can work with the same assets
- version-control or sync solutions remain possible

An internal database/index may accelerate lookup, but should generally be rebuildable from disk.

---

# 7. Project Context

Introduce a centralized project/workspace context.

Conceptually:

```ts
interface WorkspaceContext {
  mode: "standalone" | "project";
  project?: ProjectContext;
}
```

Possible project representation:

```ts
interface ProjectContext {
  id: string;
  name: string;
  rootPath: string;
  manifestPath: string;

  storage: ProjectStorageService;
  assets: ProjectAssetService;
}
```

Exact implementation should be adapted to the existing LightTable architecture.

Do not force this interface if an existing workspace/document architecture provides a cleaner integration.

---

# 8. Storage Abstraction

Other LightTable systems should not care where files physically live.

Example:

```ts
generationStorage.saveOutput(...)
referenceStorage.import(...)
assetService.search(...)
thumbnailService.get(...)
```

Those systems can internally resolve to either project or standalone storage.

Concept:

```text
Active Project?
    YES → resolve against ProjectContext
    NO  → use standalone/default storage policy
```

This is especially important for GenAI.

The GenAI panel should not contain project path-building logic.

---

# 9. File Menu

Initial suggested structure:

```text
File
  New...
  Open...
  Save
  Save As...
  ----------------
  New Project...
  Open Project...
  Close Project
  Recent Projects
```

Projects must not replace normal document workflows.

## New Project

Opens a small project setup dialog.

Initial fields:

```text
Project Name
Location               [ Browse... ]

[ Create Project ]
```

Later options can include:

- template
- custom directory structure
- project settings
- copy/reference existing assets
- GenAI defaults

Keep v1 simple.

---

# 10. Creating a Project

`File → New Project...`

Suggested operation:

1. Validate project name/location
2. Create project root
3. Create configured default directories
4. Create `.lighttable` internal directories
5. Write `project.ltproject`
6. Open the project
7. Build the initial asset index
8. Start filesystem watching
9. Update recent projects

Creation should preferably behave transactionally.

If creation fails halfway through, avoid leaving a project that appears valid but is only partially initialized.

---

# 11. Opening a Project

`File → Open Project...`

Expected behavior:

1. Locate/read `project.ltproject`
2. Validate project format/version
3. Resolve directory mappings
4. Create `ProjectContext`
5. Start filesystem watchers
6. Load or rebuild project indexes
7. Make project available to project-aware panels/services
8. Add/update recent project entry

Missing optional directories may be recreated or surfaced gracefully.

Do not crash because a user manually deleted an empty asset directory.

---

# 12. Closing a Project

Closing a project should:

- stop project filesystem watchers
- flush relevant project metadata/index state
- release project-only resources
- clear `ProjectContext`
- return LightTable to standalone mode

Open documents should not necessarily need to close.

A document and a project are separate concepts.

---

# 13. Documents Are Not Owned by Projects

A project is primarily a **workspace and storage context**.

Do not make all open documents children of the current project.

Examples that must remain possible:

- open an external TIFF while a project is active
- edit an image outside the project
- Save As outside the project
- drag an external file into LightTable
- work on a standalone document after closing the project

When a project is active, dialogs can default to useful project locations, but the project must not become a filesystem sandbox.

---

# 14. GenAI Integration

The project system should be designed from the start to support the GenAI panel.

## Reference inputs

When a user:

- pastes an image
- drags an image
- browses an image
- adds an image as a GenAI visual reference

and a project is active, LightTable may persist that input under:

```text
AiRenders/Input/
```

The generation should reference the persisted asset rather than an ephemeral clipboard/temp source where practical.

This allows generation history to remain reproducible.

---

# 15. Generation Outputs

When a project is active:

```text
generation output
    → AiRenders/History/
```

or another configured logical destination.

The implementation should preserve enough information to later support:

- generation history
- "reuse settings"
- "send back to prompt"
- model/provider inspection
- reference restoration
- provenance
- regeneration
- comparison

Do not overbuild the UI in the first implementation.

The important requirement now is that storage architecture does not prevent these features later.

---

# 16. `@asset` Prompt Lookup

The GenAI prompt box will support project asset lookup.

Example:

```text
@red_robot
```

or:

```text
@john
```

As the user types after `@`, LightTable should surface matching assets from the active project.

Candidate folders initially include:

```text
Characters/
Props/
Environments/
Sets/
AiRenders/
```

The exact search scope should remain configurable/extensible.

---

# 17. Do Not Scan Disk on Every Keystroke

Do not recursively scan the project directory every time the user types in the prompt.

Instead:

```text
Open project
    ↓
Initial asset scan
    ↓
Build in-memory asset index
    ↓
Start filesystem watcher
    ↓
Keep index synchronized
    ↓
@ search queries the index
```

This should make autocomplete effectively instantaneous even for larger projects.

---

# 18. Asset Index

The first implementation can remain simple.

Possible indexed fields:

```ts
interface ProjectAssetEntry {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  type?: string;
  extension: string;
  modifiedAt?: number;
  thumbnailId?: string;
}
```

Future metadata can include:

- tags
- semantic asset type
- character identity
- generation provenance
- embeddings
- aliases
- favorites
- usage count
- dimensions
- duration
- model relationships

Do not require these for v1.

---

# 19. Filesystem Watching

When a project is active, changes made outside LightTable should eventually be reflected automatically.

Examples:

- file copied into `Characters`
- asset renamed in Explorer
- prop deleted externally
- AI render added by another process

Watcher responsibilities:

- update project asset index
- invalidate thumbnails if needed
- notify relevant UI
- avoid unnecessary full rescans

Debounce/batch noisy filesystem events.

Take platform differences into account.

---

# 20. Preferences

Add a future/initial preference section:

```text
Preferences
  → Projects
```

Potential options:

```text
Default Project Location
Default Project Folder Template

Folder Mappings
  AI Renders
  AI History
  AI Input
  Characters
  Props
  Environments
  Sets
  Trash

Internal
  Cache
  Thumbnails
  Index
  Temp
```

Important distinction:

- **Application defaults** define how new projects are created.
- **Project manifest mappings** define where folders for an existing project are located.

Changing the global default should not silently restructure existing projects.

A future explicit "Apply / Migrate Project Structure" operation could handle that.

---

# 21. Standalone GenAI Storage

GenAI must also work without a project.

Introduce a configurable standalone storage policy.

For example:

```text
Preferences
  → GenAI
      Standalone AI Output Location
      Standalone AI Input Location
      Standalone AI History Location
```

Or use one application-managed LightTable data directory initially.

The exact standalone design is flexible.

The key requirement is:

> GenAI features must never require the user to create a project.

---

# 22. Cache Rules

Caches are implementation details.

Rules:

1. Cache may be deleted at any time.
2. Cache must be rebuildable.
3. Unique user assets must never exist only in cache.
4. Opening a project with no cache must work normally.
5. Large caches should eventually have cleanup controls.

---

# 23. Path Safety

Centralize path handling.

Consider:

- invalid filenames
- Windows reserved names
- path traversal
- project moved to another disk
- relative vs absolute paths
- case sensitivity
- Unicode filenames
- missing volumes/network shares
- symlinks/junctions
- very long paths
- duplicate asset names

Prefer storing project-internal references as project-relative paths whenever practical.

---

# 24. Project Portability

A project folder should ideally be movable.

Example:

```text
D:\Projects\CommercialA
```

can later become:

```text
E:\Archive\CommercialA
```

without breaking internal project assets.

Therefore avoid unnecessary absolute paths for files located inside the project.

External files may still require absolute paths or another explicit reference mechanism.

---

# 25. Recent Projects

Maintain a recent-project list independently from recent documents.

Possible UI:

```text
File
  Recent Projects
    Commercial A
    Character Tests
    Desert Film
```

Store:

- manifest path
- display name
- last opened timestamp

Handle missing/moved projects gracefully.

---

# 26. Status/UI Indicator

When a project is active, show a subtle project indicator somewhere appropriate in the LightTable shell.

Example:

```text
Project: Desert Film
```

Without a project:

```text
No Project
```

This can later become interactive for:

- switching projects
- opening project folder
- project settings
- closing project

Do not make it visually dominant.

---

# 27. Architectural Separation

Prefer these conceptual responsibilities:

```text
ProjectManager
    open/create/close project
    recent projects
    active ProjectContext

ProjectStorageService
    resolve logical folders
    create directories
    project-relative path handling

ProjectAssetService
    asset index
    search
    @asset lookup
    filesystem updates

ProjectWatcher
    observe relevant directories

ProjectManifestService
    read/write/migrate project.ltproject
```

These names are suggestions only.

The coding agent should integrate with existing LightTable services rather than blindly adding duplicate abstractions.

---

# 28. Avoid Over-Coupling

Do not make every feature depend directly on `ProjectManager`.

Prefer dependency boundaries such as:

```text
GenAI
  → AssetService
  → GenerationStorage

Thumbnail System
  → Storage Resolver

File Browser
  → Workspace Context
```

This makes standalone mode natural rather than a large collection of project-null checks.

---

# 29. Suggested V1 Scope

Implement only the foundation first.

## Required

- New Project
- Open Project
- Close Project
- Recent Projects
- default directory creation
- configurable directory mappings in Preferences
- project manifest
- active project context
- centralized project path resolver
- asset scan
- basic asset index
- filesystem watcher
- `@asset` search API
- GenAI input destination
- GenAI history/output destination
- hidden internal `.lighttable` folder
- standalone mode remains fully functional

## Can come later

- advanced asset browser
- semantic asset metadata
- tags
- embeddings
- AI semantic search
- character identities
- prop databases
- set metadata
- generation browser
- dependency graphs
- project templates
- cloud sync
- collaboration
- migration UI
- advanced Trash behavior

---

# 30. Important UX Principle

Projects should feel like a useful organizational layer, never an obligation.

The intended mental model:

> LightTable is still a normal image editor.  
> Opening a Project adds structured storage, assets, GenAI context, history, and reusable resources.

A user who never uses Projects should still have a complete and natural LightTable experience.
