# Layer capabilities

Status: **target contract**.

Layer affordances are projections of one semantic capability resolver. Panels,
menus, shortcuts, Actions and MCP may not maintain separate `if layer.type`
matrices.

Capabilities describe admitted operations such as transform, rasterize,
merge-down, vector edit and pixel edit. A denial includes a user-meaningful
reason (locked, missing renderer capability, incompatible document, no content,
or unsupported semantics).

`layer.rasterize` evaluates every visible contribution owned by the target—its
intrinsic content, masks, processing, effects/styles, clipping and transform—
into one measured raster result with identity transform, unless the command
explicitly defines a narrower mode. Text, vector, gradient and processed raster
layers are therefore candidates when the renderer can faithfully evaluate them.

The resolver does not mutate or probe the live renderer. Required execution
capabilities are published into a stable capability snapshot. UI visibility and
actual command admission must use the same snapshot revision.
