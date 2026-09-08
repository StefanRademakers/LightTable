# Document ownership

Status: **target contract**.

## Authorities

| State | Sole authority | Explicitly not authority |
| --- | --- | --- |
| serializable layers, masks, selection and processing graph | canonical document store | React, renderer, thumbnails |
| undo/redo position and retained undo payloads | document history store | keyboard handler, tool |
| in-flight gesture baseline and preview revision | edit transaction | React component, layer object |
| GPU textures, buffers and pipelines | resource/renderer implementation | canonical document |
| visual frame and overlays | renderer projection | save format, history |
| active tool and its application-level options | editor application session | image document |

Every operation captures a `DocumentSessionId` and expected
`DocumentRevision`. “Currently active document” is not a valid async identity.
A late result against another revision fails closed.

## Canonical selection

A committed selection is one document-space coverage resource plus its origin,
extent and revision. Bounds, marching ants, thumbnails, paint clipping and copy
regions derive from that same revision. Viewport clipping may limit work or
display, but may not rewrite or shrink the canonical selection. A translated
selection is derived from the gesture's opening snapshot and final cumulative
delta, never from the previously clipped preview.

## Mutation rule

Canonical state changes only in the commit phase of one admitted semantic
command. Projection callbacks may report measurement or execution results, but
cannot directly publish document state or history. If an operation cannot
prepare its complete document/history/resource effect, it remains legacy.
