# Lighttable — RAW Photo Workflow & Lightroom-Style Batch Editing

## Goal

Add a Lightroom-style photography workflow to **Lighttable** while reusing as much of the existing architecture as possible.

The intention is **not** to build a separate Lightroom clone or a second application mode with its own independent systems.

Instead, extend the systems Lighttable already has:

- Project folders
- Asset Browser
- Thumbnail generation/cache
- Existing grading stack
- Existing WebGPU image pipeline
- Existing document/project model
- Existing Properties panel
- Existing undo/redo
- Existing export pipeline

The new functionality should mainly add:

1. RAW file ingestion
2. Non-destructive RAW develop settings
3. A `Photos` project folder role
4. Photo browsing and filmstrip workflows
5. Rating / pick / reject metadata
6. Copy / Paste / Sync grade workflows
7. Fast switching between photos without creating heavy documents
8. Optional promotion of a photo into a full layered Lighttable document

---

# 1. Core Principle

A RAW photo should remain the immutable source.

Lighttable stores **instructions**, not a newly rendered copy of the image.

```text
RAW file
   ↓
RAW Decode / Develop
   ↓
Linear high precision RGB
   ↓
Existing Lighttable Grade
   ↓
Display
```

Example:

```text
Photos/
    DSC_4021.ARW
    DSC_4022.ARW
    DSC_4023.ARW
```

Lighttable project metadata stores:

```json
{
  "DSC_4021.ARW": {
    "rating": 5,
    "pick": true,
    "rawDevelop": {},
    "grade": {}
  }
}
```

The original `.ARW`, `.CR3`, `.NEF`, `.DNG`, etc. is never modified.

---

# 2. Reuse Existing Project Folder System

Lighttable already has configurable project folders such as:

```text
Characters
Environments
Props
Sets
```

Add a new default folder:

```text
Photos
```

Recommended default project layout:

```text
Project/
├── Photos/
├── Characters/
├── Environments/
├── Props/
├── Sets/
├── AiRenders/
├── History/
├── Input/
└── Trash/
```

`Photos` should remain configurable in Preferences like the other project folders.

## Folder Role

Do not make application behavior depend purely on a folder being literally named `Photos`.

Internally give configured folders a role.

```ts
export type ProjectFolderRole =
  | "generic"
  | "photos"
  | "characters"
  | "environments"
  | "props"
  | "sets";
```

Example:

```ts
export interface ProjectFolderDefinition {
  id: string;
  name: string;
  role: ProjectFolderRole;
}
```

A user could therefore configure:

```json
{
  "name": "Shoot",
  "role": "photos"
}
```

while Lighttable still knows that photography-specific behavior applies.

For the first implementation the UI does not need to expose folder roles. `Photos` can simply be created as the default photo-role folder.

---

# 3. Reuse the Existing Asset Browser

Do **not** build a separate Library system first.

The current Asset Browser already solves much of the problem:

- directory discovery
- thumbnails
- preview cache
- scrolling
- selection
- search
- project-relative assets
- file watching
- asset categories

Extend this browser with a photo-specific asset type.

```ts
export interface PhotoAsset {
  id: string;
  path: string;
  filename: string;

  previewPath?: string;

  fileType:
    | "raw"
    | "jpeg"
    | "png"
    | "tiff"
    | "other";

  rawFormat?: string;

  width?: number;
  height?: number;

  rating: 0 | 1 | 2 | 3 | 4 | 5;
  pick: boolean;
  rejected: boolean;

  hasDevelopSettings: boolean;
  hasGrade: boolean;

  metadata?: PhotoMetadata;
}
```

## Photo Metadata

```ts
export interface PhotoMetadata {
  cameraMake?: string;
  cameraModel?: string;
  lens?: string;

  focalLengthMm?: number;
  iso?: number;
  aperture?: number;
  shutterSeconds?: number;

  capturedAt?: string;

  orientation?: number;
}
```

The existing Asset Browser continues to show project assets normally.

When a folder has role `photos`, enable photography-specific behaviors.

---

# 4. Asset Browser Photo UI

The existing vertical Assets panel remains useful for quick browsing.

A photo thumbnail can add small status indicators:

```text
┌──────────────────────┐
│                      │
│       PHOTO          │
│                      │
│ ★★★★             RAW │
│ DSC_2831.CR3      ●  │
└──────────────────────┘
```

Possible indicators:

- `RAW`
- rating
- Pick
- Rejected
- edited / has grade
- currently open

Avoid putting too much text over the image.

---

# 5. Full Photo Grid

The existing narrow Assets panel is not ideal for selecting hundreds of photos.

Add a larger **Photo Grid** view that still uses the same browser/index/cache infrastructure.

This is a different presentation of the same asset data, not a separate library.

```text
┌───────────────────────────────────────────────────────┐
│ Photos                                   Search       │
├───────────────────────────────────────────────────────┤
│                                                       │
│ [ IMG01 ] [ IMG02 ] [ IMG03 ] [ IMG04 ] [ IMG05 ]   │
│                                                       │
│ [ IMG06 ] [ IMG07 ] [ IMG08 ] [ IMG09 ] [ IMG10 ]   │
│                                                       │
│ [ IMG11 ] [ IMG12 ] [ IMG13 ] [ IMG14 ] [ IMG15 ]   │
│                                                       │
└───────────────────────────────────────────────────────┘
```

Use virtualization so a folder containing thousands of photos does not create thousands of DOM elements.

Reuse existing thumbnail cache.

---

# 6. Filmstrip

When editing a photo, provide an optional horizontal filmstrip.

```text
┌───────────────────────────────────────────────────────┐
│                                                       │
│                     ACTIVE PHOTO                      │
│                                                       │
│                                        Properties     │
│                                                       │
├───────────────────────────────────────────────────────┤
│ [01] [02] [03] [04] [05] [06] [07] [08] [09] [10]  │
└───────────────────────────────────────────────────────┘
```

This is especially important for high-volume grading.

The filmstrip should use the same photo asset model and thumbnail cache as the Assets browser.

Recommended behavior:

- click → activate photo
- Ctrl/Cmd click → toggle selection
- Shift click → range select
- Left / Right → previous / next photo
- Enter / double click → open active photo
- optional mouse wheel / trackpad horizontal scrolling

The filmstrip should be hideable.

---

# 7. RAW Decoder

## Recommended Base

Use **LibRaw compiled to WebAssembly** as the initial RAW ingestion layer.

Purpose:

```text
CR3 / NEF / ARW / RAF / DNG / RW2 / ORF / ...
                     ↓
                  LibRaw
                     ↓
             decoded RAW data
                     ↓
        Lighttable RAW Develop pipeline
```

LibRaw solves the difficult camera/file-format compatibility problem.

Do not convert the RAW to an 8-bit JPEG before entering the Lighttable pipeline.

Avoid:

```text
RAW
 ↓
8-bit JPEG / sRGB
 ↓
Lighttable
```

Preferred:

```text
RAW
 ↓
RAW decoder
 ↓
high precision linear RGB
 ↓
rgba16float
 ↓
Lighttable WebGPU
```

---

# 8. RAW Develop Pipeline

Suggested pipeline:

```text
RAW file
   ↓
Parse metadata
   ↓
Sensor decode
   ↓
Black level normalization
   ↓
White level normalization
   ↓
Bad pixel handling
   ↓
Demosaic
   ↓
White balance
   ↓
Highlight reconstruction
   ↓
Camera RGB → working RGB
   ↓
Optional lens corrections
   ↓
Optional RAW noise reduction
   ↓
rgba16float
   ↓
Existing Lighttable image pipeline
```

The exact division between LibRaw/WASM and WebGPU can evolve.

## Phase 1

Let LibRaw do more of the RAW development.

Get good camera compatibility first.

## Phase 2

Move selected operations into Lighttable/WebGPU where there is a clear quality, consistency or performance benefit.

Candidates:

- exposure
- white balance
- highlight handling
- color transforms
- lens corrections
- chromatic aberration
- noise reduction

Do not rewrite camera-format parsing.

---

# 9. RAW Develop Settings

RAW-specific controls are conceptually different from the existing grade.

Example:

```ts
export interface RawDevelopSettings {
  enabled: boolean;

  whiteBalanceMode:
    | "as-shot"
    | "auto"
    | "custom";

  temperatureKelvin?: number;
  tint?: number;

  exposureCompensationEv?: number;

  highlightRecovery?: number;

  demosaicMode?: string;

  lensCorrection?: {
    distortion: boolean;
    chromaticAberration: boolean;
    vignette: boolean;
  };
}
```

Do not expose every LibRaw option directly in the UI.

Lighttable should expose a curated photography interface.

---

# 10. Existing Grade Stack

Reuse the current grading stack.

Current structure already contains roughly:

```text
Light
├── Exposure
├── Contrast
├── Highlights
├── Shadows
├── Whites
├── Blacks
└── Lift

Color
├── Temperature
├── Tint
├── Vibrance
└── Saturation

Texture / Clarity / Dehaze
├── Texture
├── Clarity
└── Dehaze

Detail
├── Sharpening
├── Noise Reduction
└── Color Noise Reduction

Color Mixer
├── Hue
├── Saturation
└── Luminance

Color Grading
├── Shadows
├── Midtones
├── Highlights
├── Global
├── Blending
└── Balance

Custom Curves
├── RGB
├── R
├── G
└── B
```

Do not build a separate Lightroom grade engine.

Make the existing grade serializable and reusable.

```ts
export interface GradeSettings {
  light: LightSettings;
  color: ColorSettings;
  texture: TextureSettings;
  detail: DetailSettings;
  colorMixer: ColorMixerSettings;
  colorGrading: ColorGradingSettings;
  curves: CurveSettings;
}
```

---

# 11. Temperature / Tint Ownership

RAW white balance and creative grading temperature need a clear ownership model.

Recommended:

## RAW file

The primary Temperature / Tint controls operate as RAW white balance when a RAW source is active.

```text
RAW
 ↓
Temperature / Tint = sensor/develop WB
 ↓
working RGB
```

## Normal RGB layer

The same UI can continue to perform the current RGB-domain temperature/tint adjustment.

This allows one UI while selecting the correct implementation based on source type.

Internally keep them separate:

```ts
rawDevelop.whiteBalance
```

versus:

```ts
grade.color.temperature
grade.color.tint
```

This prevents ambiguity in saved documents.

---

# 12. Non-Destructive Photo State

Each photo gets lightweight editing metadata.

```ts
export interface PhotoDevelopState {
  version: number;

  sourcePath: string;

  raw?: RawDevelopSettings;

  grade: GradeSettings;

  rating: 0 | 1 | 2 | 3 | 4 | 5;
  pick: boolean;
  rejected: boolean;

  modifiedAt: number;
}
```

A photo does not need a full layered document simply because it was graded.

This is important.

Opening 500 RAW files should not create 500 heavy `.lighttable` documents.

---

# 13. Where to Store Photo Develop State

Preferred initial architecture:

Store it in the existing Lighttable project metadata/database.

Conceptually:

```text
Project
 ├── Photos
 │    ├── DSC_0001.CR3
 │    ├── DSC_0002.CR3
 │    └── DSC_0003.CR3
 │
 └── project metadata
      ├── DSC_0001.CR3 → develop state
      ├── DSC_0002.CR3 → develop state
      └── DSC_0003.CR3 → develop state
```

Optionally add sidecar support later.

Example:

```text
DSC_0001.CR3
DSC_0001.ltgrade
```

Sidecars are useful for:

- portability
- copying files between projects
- backup
- interoperability with external tooling

But they do not need to block the first implementation.

---

# 14. Preview Cache

Do not fully RAW-decode every visible thumbnail every time.

Generate and cache preview images.

Possible cache levels:

```text
thumbnail      ~256 px
medium preview ~1024–2048 px
full develop   viewport/full resolution
```

Suggested behavior:

```text
Asset Browser
   ↓
thumbnail cache

Filmstrip
   ↓
thumbnail cache

Photo Grid
   ↓
thumbnail cache

Active image
   ↓
medium/full RAW develop
```

If RAW files contain usable embedded JPEG previews, those may be useful for very fast initial thumbnails.

The final editable image must still come through the real RAW pipeline.

---

# 15. Fast Photo Switching

Switching between photos must feel immediate.

Recommended strategy:

```text
Current
Previous
Next
```

Keep decoded/developed preview data for a small sliding window.

Example:

```text
[Photo 102] previous cache
[Photo 103] active
[Photo 104] prefetch
```

When the active photo changes:

1. instantly display cached preview if available
2. load saved DevelopState
3. start/continue full-resolution RAW decode
4. replace preview when ready

Do not block the UI while decoding.

Use workers/WASM threads where practical.

---

# 16. Copy Grade

Add:

```text
Copy Grade
Paste Grade
```

The copied object is the existing `GradeSettings`.

```ts
interface GradeClipboard {
  version: number;
  grade: Partial<GradeSettings>;
}
```

Support copying all or selected sections.

Example UI:

```text
Copy Grade

[x] Light
[x] Color
[ ] Texture / Clarity / Dehaze
[ ] Detail
[x] Color Mixer
[x] Color Grading
[x] Curves
```

Do not duplicate image pixels.

---

# 17. Paste Grade to Multiple Photos

Multi-select photos in:

- Asset Browser
- Photo Grid
- Filmstrip

Then:

```text
Paste Grade
```

Conceptually:

```text
Master Photo
     ↓
 Copy Grade
     ↓
 ┌───────┬───────┬───────┬───────┐
 ↓       ↓       ↓       ↓
Photo B Photo C Photo D Photo E
```

Only the selected serialized settings are applied.

This should be extremely cheap computationally.

Rendering can be lazy.

---

# 18. Sync Grade

Add a Lightroom-style master/active selection model.

Example:

```text
Selected:
Photo A  ← active/master
Photo B
Photo C
Photo D
```

`Sync Grade` copies selected grading categories from `Photo A` to the other selected photos.

Possible command:

```ts
syncGrade({
  source: activePhoto,
  targets: selectedPhotos,
  sections: [
    "light",
    "color",
    "colorMixer",
    "colorGrading",
    "curves"
  ]
});
```

---

# 19. Auto Sync

Optional after basic Sync works.

When Auto Sync is enabled:

```text
20 photos selected
       ↓
Exposure +0.2
       ↓
Apply same parameter change to all selected photos
```

Important:

Auto Sync should ideally propagate the **parameter operation**, not blindly replace the entire grade object.

Example:

```ts
applyGradePatchToSelection({
  path: "light.exposure",
  value: 0.2
});
```

This prevents unrelated settings from being overwritten.

---

# 20. Previous Grade

A very useful fast-shoot workflow:

```text
Photo 101 → grade
Photo 102 → Previous
Photo 103 → Previous
Photo 104 → modify
Photo 105 → Previous
```

Command:

```text
Apply Previous Grade
```

This copies the previous photo's selected/all grade settings to the active image.

Simple feature, high workflow value.

---

# 21. Grade Presets

Because the grade already becomes a serializable object, presets become trivial.

```ts
export interface GradePreset {
  id: string;
  name: string;
  grade: Partial<GradeSettings>;
}
```

Example:

```text
Presets
├── Clean Portrait
├── Warm Editorial
├── High Contrast
├── Soft Film
└── Product Neutral
```

Presets should use the exact same serialization format as Copy/Paste Grade.

Do not create a separate preset engine.

---

# 22. Relative vs Absolute Settings

Initial version can use absolute values.

Example:

```text
Exposure = +0.6 EV
Contrast = 10
```

Later it may be useful to support relative batch edits:

```text
Exposure += 0.2 EV
Temperature += 150 K
```

This is particularly useful when multiple selected photos already have different individual corrections.

Design commands so relative edits can be added later.

---

# 23. Rating / Pick / Reject

Add lightweight selection metadata:

```text
0–5 stars
Pick
Reject
```

Suggested keys can be configurable later.

Possible defaults:

```text
1–5 = rating
P   = Pick
X   = Reject
0   = clear rating
```

Do not physically move rejected photos automatically.

Filtering can hide them.

---

# 24. Photo Filtering

Reuse Asset Browser filtering infrastructure where possible.

Possible filters:

```text
All
RAW
Edited
Unedited
Picks
Rejected
★★★★★
★★★★+
```

Later:

```text
Camera
Lens
ISO
Capture date
File type
```

Keep v1 small.

---

# 25. Promote Photo to Full Lighttable Document

A graded photo is not automatically a layered document.

When the user starts doing operations that require document structure:

- Add layer
- Paint
- Clone
- Healing
- Text
- Vector
- AI generation as a layer
- 3D layer
- complex masks/compositing

Lighttable can promote/create a full document.

Conceptually:

```text
RAW Photo
   ↓
RAW Develop
   ↓
Base Grade
   ↓
"Edit as Document"
   ↓
Layer Stack
```

Full document:

```ts
interface LighttableDocument {
  source?: {
    type: "raw" | "image";
    path: string;
  };

  rawDevelop?: RawDevelopSettings;

  baseGrade?: GradeSettings;

  layers: Layer[];

  globalGrade?: GradeSettings;
}
```

The source RAW can remain externally referenced.

---

# 26. Suggested Image Pipeline

For a photo-only workflow:

```text
RAW Source
   ↓
RAW Decode
   ↓
RAW Develop
   ↓
Base Grade
   ↓
Display Transform
   ↓
Viewer
```

For a full Lighttable document:

```text
RAW Source
   ↓
RAW Develop
   ↓
Base Grade
   ↓
Base Image
   ↓
Layer Stack
   ↓
Composite
   ↓
Global Grade
   ↓
Display Transform
   ↓
Viewer / Export
```

This keeps the RAW stage separate from creative compositing.

---

# 27. Grade Naming

The current panel is called `Local Grade`.

For the photography workflow, consider whether the primary photo grade should instead become:

```text
Grade
```

or:

```text
Base Grade
```

Recommended conceptual model:

```text
RAW Develop
   ↓
Base Grade
   ↓
Layers
   ├── optional per-layer Grade
   └── optional masks
   ↓
Composite
   ↓
Global Grade
```

This makes the hierarchy easier to understand.

`Local Grade` is a better name for an adjustment that applies to a specific layer or mask than for the primary development grade of a photo.

This can be evaluated separately from the RAW implementation.

---

# 28. UI Integration

Do not introduce a Lightroom-style modal separation such as:

```text
LIBRARY | DEVELOP
```

unless later testing proves it necessary.

Prefer Lighttable's existing workspace.

## Assets tab

```text
Assets
├── Photos
├── Characters
├── Environments
├── Props
└── Sets
```

## Editing

```text
Main canvas
+
Properties / Grade
+
optional Filmstrip
```

## Selecting

```text
Photo Grid
```

This keeps Lighttable feeling like one application rather than two editors glued together.

---

# 29. Suggested Commands

Add commands to the central command/action system rather than hard-coding UI behavior.

```ts
photo.open
photo.next
photo.previous

photo.rating.set
photo.pick
photo.reject

photo.grade.copy
photo.grade.paste
photo.grade.previous
photo.grade.sync
photo.grade.autoSync.toggle

photo.grid.open
photo.filmstrip.toggle

photo.promoteToDocument
```

This makes the functionality reusable by:

- menu
- context menu
- keyboard shortcuts
- Agent/MCP
- command palette
- future automation

---

# 30. Context Menus

Photo thumbnail:

```text
Open
Open in Photo Grid

────────────────

Copy Grade
Paste Grade
Apply Previous Grade
Sync Selected...

────────────────

Rating
Pick
Reject

────────────────

Reveal in Explorer
Remove from Project
```

Only show relevant commands.

---

# 31. Undo / Redo

Reuse the existing undo/redo architecture.

Grade changes should be commands/patches:

```ts
setGradeValue(photoId, path, oldValue, newValue)
```

Batch change:

```ts
BatchGradeCommand {
  changes: [
    { photoId, path, oldValue, newValue },
    ...
  ]
}
```

One Sync/Paste action should ideally be one undo step.

---

# 32. Save Strategy

Do not save on every slider frame.

While dragging:

```text
GPU preview updates continuously
```

On interaction commit:

```text
update state
push undo command
schedule project metadata save
```

Debounce project persistence.

The grade data itself is tiny.

---

# 33. Thumbnail Invalidations

A thumbnail can represent either:

1. original source preview
2. graded preview

Recommended:

- initially show source/embedded preview
- after an image is edited, asynchronously generate a graded thumbnail
- store a grade/settings hash with cached thumbnails

Example:

```ts
interface ThumbnailCacheEntry {
  sourceMtime: number;
  gradeHash: string;
  path: string;
}
```

When `gradeHash` changes, regenerate when convenient.

Do not block slider interaction.

---

# 34. RAW Decode Cache

RAW decode is much more expensive than applying a grade.

Cache an intermediate high-precision developed image where useful.

Possible strategy:

```text
RAW file
 ↓ expensive decode
Linear developed cache
 ↓ cheap grade changes
WebGPU
```

Do not re-run full RAW parsing/demosaicing when moving a simple Contrast slider.

White balance behavior may require reprocessing depending on how the RAW pipeline is implemented, but normal creative grade operations should remain GPU-fast.

---

# 35. Background Processing

Use background jobs for:

- RAW thumbnail extraction
- metadata extraction
- RAW decode
- preview generation
- graded thumbnail rendering
- cache cleanup

Suggested abstraction:

```ts
interface PhotoJob {
  id: string;
  type:
    | "metadata"
    | "thumbnail"
    | "raw-decode"
    | "graded-preview";

  priority: number;
  photoId: string;
}
```

Active photo jobs get highest priority.

Visible filmstrip/grid items come next.

Offscreen items are lowest priority.

---

# 36. Files to Support

Initial photography input targets:

```text
JPEG
PNG
TIFF

DNG
CR2
CR3
NEF
ARW
RAF
ORF
RW2
```

Actual LibRaw camera support can be broader.

Do not promise format support solely based on extension.

Detect decoder support and report unsupported files cleanly.

---

# 37. Import Semantics

Because Lighttable already has a project folder system, "Import" does not necessarily need to mean Lightroom-style catalog ingestion.

Support two simple approaches:

## A. Copy into Photos

```text
Import Photos
→ select files/folder
→ copy into Project/Photos/...
```

## B. Reference external files

Possible later:

```text
Add Photos From Folder
→ leave files where they are
→ project references them
```

Start with the model that best matches Lighttable's current project conventions.

Do not duplicate files silently.

---

# 38. Optional Album / Collection Layer

Do not make albums a dependency for v1.

The physical `Photos` folder plus subfolders is enough.

Later add virtual collections:

```text
Photos
├── Folders
│   ├── Shoot 01
│   └── Shoot 02
│
└── Collections
    ├── Picks
    ├── Client Selection
    └── Portfolio
```

A collection stores references, not duplicate photos.

```ts
interface PhotoCollection {
  id: string;
  name: string;
  photoIds: string[];
}
```

---

# 39. Database / Project Index

If the current project metadata starts becoming large, photo metadata is a good candidate for SQLite.

Potential tables:

```sql
photos
photo_develop_state
photo_collections
photo_collection_items
```

But do not introduce a database only for this feature if the existing project model already supports the expected scale.

Start with current infrastructure and profile it.

---

# 40. Performance Targets

Target interaction:

### Existing cached thumbnail
Effectively instant.

### Filmstrip navigation
Preview visible immediately from cache.

### Grade slider
Interactive GPU feedback at existing editor frame rate.

### Copy/Paste grade
Immediate state update; rendering scheduled lazily.

### Grid
Smooth with thousands of assets through virtualization.

### RAW decode
Asynchronous and cancelable where possible.

---

# 41. Memory / VRAM

Do not keep every RAW image fully decoded.

Maintain a bounded LRU cache.

Example:

```ts
RawPreviewCache
  maxCpuBytes
  maxGpuBytes
```

Prioritize:

```text
active
next
previous
recently viewed
```

Evict older data.

The thumbnail cache can remain disk-backed.

---

# 42. Minimal Phase 1

The first useful version should be deliberately small.

## Phase 1A — RAW ingestion

- Add RAW extensions
- LibRaw/WASM
- metadata extraction
- thumbnail/preview generation
- open RAW into existing editor
- convert to existing `rgba16float` pipeline
- preserve source RAW unchanged

## Phase 1B — Photo state

- `Photos` project folder
- store per-photo GradeSettings
- restore grade when photo is reopened
- rating
- pick/reject

## Phase 1C — Batch workflow

- multi-select
- Copy Grade
- Paste Grade
- Previous Grade
- Sync Grade

## Phase 1D — Navigation

- Photo Grid
- Filmstrip
- previous/next
- background prefetch

At this point Lighttable already has a credible Lightroom-style workflow.

---

# 43. Phase 2

After the basic workflow is stable:

- RAW-specific Temperature/Tint
- better highlight reconstruction
- lens profiles/corrections
- RAW noise reduction
- more metadata filtering
- Auto Sync
- virtual Collections / Albums
- preset management
- relative batch adjustments
- compare mode
- before/after
- survey mode
- sidecars
- external referenced photo folders

---

# 44. Phase 3

Higher-end photography features:

- camera profiles
- DCP / ICC profile support
- advanced demosaic selection
- Fuji X-Trans tuning
- hot/dead pixel correction
- chromatic aberration analysis
- advanced lens correction
- AI denoise integration
- automatic subject/sky masks
- stack/bracket grouping
- panorama/HDR workflows
- tethered capture if ever desired

These should not block the main workflow.

---

# 45. Architecture Summary

Reuse:

```text
Existing Project System
        │
        ├── + Photos folder role
        │
Existing Asset Browser
        │
        ├── + Photo asset type
        ├── + Photo Grid
        └── + Filmstrip
        │
RAW Decoder / LibRaw WASM
        │
        ▼
Existing rgba16float WebGPU pipeline
        │
        ▼
Existing Grade Stack
        │
        ├── serialize GradeSettings
        ├── Copy
        ├── Paste
        ├── Sync
        └── Presets
        │
        ▼
Existing Viewer / Export
```

The important principle is:

> **Do not create a second Lightroom-like editing engine. Extend Lighttable's existing asset, project, grading and GPU systems with photography-specific source handling and batch workflow.**

---

# 46. Recommended Data Model

```ts
export type Rating = 0 | 1 | 2 | 3 | 4 | 5;

export interface PhotoRecord {
  id: string;
  sourcePath: string;

  rating: Rating;
  picked: boolean;
  rejected: boolean;

  metadata?: PhotoMetadata;

  rawDevelop?: RawDevelopSettings;
  grade: GradeSettings;

  createdAt: number;
  modifiedAt: number;
}

export interface PhotoMetadata {
  width?: number;
  height?: number;

  cameraMake?: string;
  cameraModel?: string;
  lens?: string;

  focalLengthMm?: number;
  iso?: number;
  aperture?: number;
  shutterSeconds?: number;

  capturedAt?: string;
}

export interface RawDevelopSettings {
  whiteBalanceMode: "as-shot" | "auto" | "custom";

  temperatureKelvin?: number;
  tint?: number;

  highlightRecovery?: number;

  lensCorrection?: {
    distortion: boolean;
    chromaticAberration: boolean;
    vignette: boolean;
  };
}

export interface GradeSettings {
  light: LightSettings;
  color: ColorSettings;
  texture: TextureSettings;
  detail: DetailSettings;
  colorMixer: ColorMixerSettings;
  colorGrading: ColorGradingSettings;
  curves: CurveSettings;
}
```

---

# 47. Implementation Rule

Wherever possible:

```text
NEW FEATURE
      ↓
Can existing Lighttable infrastructure do 80%?
      ↓
YES → extend it
NO  → create smallest isolated subsystem necessary
```

Specifically avoid duplicating:

- thumbnail systems
- browser systems
- grade implementations
- selection models
- project persistence
- undo/redo
- GPU effects
- export code
- command systems

The RAW decoder is the main genuinely new subsystem.

Everything around it should mostly be an extension of what Lighttable already has.
