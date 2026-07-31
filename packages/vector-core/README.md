# @lighttable/vector-core

Renderer- and host-independent vector geometry for LightTable.

The package owns serializable cubic paths, affine math, bounds, hit testing,
adaptive flattening and exact path edits. It deliberately has no dependency on
React, browser globals, Electron, WebGPU or the LightTable application package.

Coordinates are double-precision element-local document units. Runtime GPU
objects, cached meshes and transient editor state do not belong in this package.
