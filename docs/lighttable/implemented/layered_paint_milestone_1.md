# LightTable layered paint — milestone 1

LightTable keeps three owners:

- `editor/document`: immutable, serializable document and layer metadata. No React or GPU objects.
- `editor/session`: transient active tool, pointer and brush settings.
- `editor/rendering`: derived WebGPU layer textures, compositing and brush stroke snapshots.

Current flow:

```text
raster layers (linear premultiplied rgba16float)
  -> WebGPU normal/source-over composite
  -> existing document-wide LightTable grade and effects
  -> viewport / scopes / export
```

The imported image is the bottom raster layer. New paint layers are document-sized transparent textures. `layers[0]` is bottom-most; the panel renders the array in reverse. Layers carry opacity, visibility, lock state and a Photoshop-style blend mode. An optional document-owned mask channel has a separate GPU texture, is painted through the same brush path, and modulates layer coverage before blending.

The brush uses CPU distance-based dab placement and one instanced WebGPU draw per pointer batch. A pointer-down/up gesture owns one GPU snapshot and is one local undo unit. A single-layer save stays a regular flattened PNG with the existing LightTable grade metadata. Multi-layer saves use a PNG-compatible LightTable container: the flattened preview remains a valid PNG prefix while a footer references the manifest and separate layer/mask PNG assets appended to the file. This keeps existing image upload, thumbnail, shot and drag flows compatible while allowing LightTable to restore the editable stack. A unified mixed command history, live thumbnails and dirty-region rendering remain follow-up work.

Darkly was used only for architectural lessons: stable layer identity, distance-based spacing, explicit alpha conventions, and GPU resources as reconstructable runtime state.
