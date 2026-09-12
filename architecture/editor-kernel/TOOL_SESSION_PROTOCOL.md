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
4. The tool's declared terminal requests one commit from baseline plus final
   intent. Ordinary strokes/shapes finish on pointer-up; Free Transform only
   checkpoints its gizmo on pointer-up and commits on Enter or accepted tool exit.
5. Escape, pointer cancellation, document retirement and rejected admission
   follow the named owner's cancel/compensation protocol. OS blur alone is not
   document retirement and must not silently discard a checkpointed transform.

Auto-pan changes the viewport projection while the authored pointer continues
in document space. Snapping evaluates stable candidates excluding the selected
object, its dependent ancestors/descendants and the active preview. It applies
hysteresis so a held target does not fight an equally close alternative.

Tool switching, document switching and unmount must reach a terminal session
state. Cleanup is part of the session owner, not a collection of component
effects.
