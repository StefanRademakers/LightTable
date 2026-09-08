# Tool session protocol

Status: **target contract**.

A tool interprets input. It does not own canonical pixels, layers, selection,
history or GPU resources.

## Gesture protocol

1. Pointer-down captures document address, immutable semantic baseline and
   current tool options.
2. Pointer movement emits monotonic preview values in document coordinates.
3. Renderer projection displays the latest accepted preview directly; React is
   not in the pointer-frequency loop.
4. Pointer-up requests one commit derived from baseline plus final intent.
5. Escape, capture loss, document close or rejected revision requests cancel.

Auto-pan changes the viewport projection while the authored pointer continues
in document space. Snapping evaluates stable candidates excluding the selected
object, its dependent ancestors/descendants and the active preview. It applies
hysteresis so a held target does not fight an equally close alternative.

Tool switching, document switching and unmount must reach a terminal session
state. Cleanup is part of the session owner, not a collection of component
effects.
