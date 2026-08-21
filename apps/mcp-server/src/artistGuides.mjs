export const LIGHTTABLE_ARTIST_GUIDES = Object.freeze([
  {
    id: 'artist-onboarding',
    uri: 'lighttable://guides/artist-onboarding',
    title: 'LightTable artist onboarding',
    description: 'Plan, build, inspect and correct editable LightTable artwork with bounded MCP traffic.',
    text: `# LightTable artist onboarding

Use LightTable as a native layered editor, not as a bitmap-generation endpoint.

1. Query the workspace once, then inspect the target document, its command capabilities and only the content needed for the task.
2. Plan the layer stack before editing. Preserve text as text and vector artwork as native vectors.
3. When two or more known edits belong to one logical phase, prefer lighttable_batch over repeated lighttable_execute calls.
4. Use resultOf references inside a batch when a later operation needs an ID created by an earlier operation.
5. Build in logical phases such as background, decoration, hero shape, typography and correction.
6. Use lighttable_palette for dominant composite colors and lighttable_layer_palette for one layer's isolated rendered colors; transfer a bounded preview only when spatial or visual inspection is needed.
7. Request a bounded preview after a phase, not after every primitive.
8. Carry the canonical revision returned by writes and reads forward. Re-query only when state is genuinely unknown or a stale-revision response requires it.
9. Report unsupported visual properties honestly. Do not rasterize editable content merely to hide a missing capability.

Recommended follow-up guides:
- lighttable://guides/efficient-batching
- lighttable://guides/native-vector-paths
`
  },
  {
    id: 'efficient-batching',
    uri: 'lighttable://guides/efficient-batching',
    title: 'Efficient atomic batching',
    description: 'Combine planned semantic edits into bounded atomic publications with result references.',
    text: `# Efficient atomic batching

lighttable_execute publishes one semantic command. lighttable_batch runs up to 64 compatible operations as one named publication and one undo entry. If any operation fails, nothing is published.

Prefer one batch per logical construction phase. Do not combine edits that require a visual decision between them.

Example: create and rename editable point text in one call:

\`\`\`json
{
  "name": "Create hero title",
  "timeoutMs": 5000,
  "operations": [
    {
      "operationId": "create-title",
      "command": "text.create",
      "parameters": {
        "mode": "point",
        "text": "HAPPY",
        "origin": { "x": 300, "y": 360 }
      }
    },
    {
      "operationId": "rename-title",
      "command": "layer.rename",
      "parameters": {
        "layerId": { "resultOf": "create-title", "field": "layerId" },
        "name": "HAPPY"
      }
    }
  ]
}
\`\`\`

Query command.batch through lighttable_commands for the complete current operation schema. Carry expectedDocumentRevision at the lighttable_batch tool boundary.
`
  },
  {
    id: 'native-vector-paths',
    uri: 'lighttable://guides/native-vector-paths',
    title: 'Native Bezier vector paths',
    description: 'Create editable organic vector shapes using native subpaths, anchors and handles.',
    text: `# Native Bezier vector paths

vector.create and vector.update accept native subpaths. Use them for organic shapes instead of approximating everything with regular stars or many straight line primitives.

Each anchor has x/y coordinates, optional handleIn and handleOut, and a corner/smooth mode. Coordinates are document-space values unless a transform is supplied.

Example closed curved shape:

\`\`\`json
{
  "layerName": "Organic burst",
  "name": "Burst path",
  "subpaths": [
    {
      "id": "burst-outline",
      "closed": true,
      "anchors": [
        { "id": "a", "x": 300, "y": 180, "handleIn": null, "handleOut": { "x": 360, "y": 150 }, "mode": "smooth" },
        { "id": "b", "x": 520, "y": 300, "handleIn": { "x": 470, "y": 230 }, "handleOut": { "x": 560, "y": 380 }, "mode": "smooth" },
        { "id": "c", "x": 300, "y": 520, "handleIn": { "x": 390, "y": 550 }, "handleOut": { "x": 210, "y": 550 }, "mode": "smooth" },
        { "id": "d", "x": 100, "y": 300, "handleIn": { "x": 70, "y": 390 }, "handleOut": { "x": 140, "y": 220 }, "mode": "smooth" }
      ]
    }
  ],
  "fillRule": "nonzero",
  "style": {
    "fill": { "type": "solid", "color": [1, 0.09, 0.09, 1] },
    "opacity": 1
  }
}
\`\`\`

Query vector.create through lighttable_commands before use; the shared contract is authoritative when it differs from this guide.
`
  }
]);

export const LIGHTTABLE_ARTIST_GUIDE_SUMMARIES = Object.freeze(
  LIGHTTABLE_ARTIST_GUIDES.map(({ id, uri, title, description }) => ({ id, uri, title, description }))
);
