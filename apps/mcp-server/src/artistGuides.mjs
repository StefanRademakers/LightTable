export const LIGHTTABLE_ARTIST_GUIDES = Object.freeze([
  {
    id: 'artist-onboarding',
    version: 1,
    uri: 'lighttable://guides/artist-onboarding',
    title: 'LightTable artist onboarding',
    description: 'Plan, build, inspect and correct editable LightTable artwork with bounded MCP traffic.',
    text: `# LightTable artist onboarding

Use LightTable as a native layered editor, not as a bitmap-generation endpoint.

1. Begin with lighttable_context once. It returns the workspace, active document, active layer summary and live editor capabilities in one bounded call.
2. Keep the returned stable IDs, canonical revision and capability decisions in working memory for the session. Do not repeat unchanged workspace, document, layer or command-schema queries.
3. Use the returned capability list as your menu, then request lighttable_commands only for command schemas that the planned work will actually execute.
4. Plan the layer stack before editing. Preserve text as text and vector artwork as native vectors.
   When a generated illustration already exists as SVG data, send it once through lighttable_import_svg; supported geometry becomes editable native paths and primitives in one atomic document change.
5. When two or more known edits belong to one logical phase, prefer lighttable_batch over repeated lighttable_execute calls.
6. Use resultOf references inside a batch when a later operation needs an ID created by an earlier operation.
7. Build in logical phases such as background, decoration, hero shape, typography and correction.
8. Use lighttable_palette for dominant composite colors and lighttable_layer_palette for one layer's isolated rendered colors; transfer a bounded preview only when spatial or visual inspection is needed.
9. Request a bounded preview after a phase, not after every primitive.
10. Carry the canonical revision returned by writes and reads forward. Re-query only when state is genuinely unknown or a stale-revision response requires it.
11. Let lighttable_batch wait for accepted async work to finish before issuing dependent writes; use its returned task duration and revision instead of guessing that completion occurred.
12. Use lighttable_performance at the end of a slow flow to separate MCP tool time, LightTable bridge/command time and async task duration from Codex/model time.
13. Report unsupported visual properties honestly. Do not rasterize editable content merely to hide a missing capability.

Recommended follow-up guides:
- lighttable://guides/design-pass
- lighttable://guides/efficient-batching
- lighttable://guides/native-vector-paths
`
  },
  {
    id: 'efficient-batching',
    version: 1,
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
    version: 1,
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
  },
  {
    id: 'design-pass',
    version: 1,
    uri: 'lighttable://guides/design-pass',
    title: 'LightTable design pass',
    description: 'A compact senior-design workflow for coherent, editable artwork with few observation rounds.',
    text: `# LightTable design pass

Version 1

Use this workflow for original design, reconstruction and substantial redesign. The goal is a coherent editable result, not merely a technically valid pile of layers.

## Establish intent

Before editing, reduce the request to a short working brief:

- purpose, audience and output format;
- primary message and one intended focal point;
- desired tone and explicit things to avoid;
- supplied assets, brand constraints and required copy;
- what must remain editable.

Infer only low-risk omissions. Preserve exact user copy and supplied identity or brand assets. Let the brief guide later criticism so the design does not drift stylistically.

## Inspect once and plan

Call lighttable_context once and retain its IDs, revision, capabilities and guide versions. Inspect an existing document with bounded structure, text/vector detail, bounds and palette queries. Use a 512px WebP only when pixels add information that structure cannot provide.

Plan these five things before construction:

1. visual hierarchy and focal point;
2. composition, margins, grid and major spatial relationships;
3. typography roles and a deliberately small type scale;
4. palette, contrast and the role of each accent color;
5. editable layer/group structure and meaningful names.

Prefer a small repeated spacing vocabulary inferred from the brief or existing work. Consistency matters more than forcing a universal numeric grid.

## Build from large to small

Construct in logical phases: foundation, major composition, typography, supporting elements, then polish. Use one atomic lighttable_batch per phase when no visual decision is needed between its operations. Keep text as text, reusable geometry as vectors and photos as raster content. Preserve gradients, effects and adjustments as editable properties where supported.

Avoid premature detail, accidental near-duplicate colors, gratuitous effects, arbitrary radii, too many type styles and dozens of fragments that should be one logical group. Do not rasterize merely to conceal an unsupported capability.

Use layer.rasterize only when the user requests destructive finalization or when a declared output contract explicitly requires pixels. Discover its current schema first, target one stable layerId, and retain the returned outputLayerId for later operations. A layer that is already a plain raster with no live processing normally gains nothing from being rasterized again.

## Review economically

After a meaningful phase, review at the cheapest useful level:

1. structure, bounds and palette for exact facts;
2. a 512px WebP at quality 0.78 for the overall composition;
3. a region preview for local typography, alignment or edge craft;
4. an isolated layer preview only when compositing hides the source problem;
5. lossless PNG only for alpha, pixel-level or final technical verification.

Do not preview after every primitive. A visual review should answer a real question.

## Critique before correcting

Rank at most five issues by impact. Judge:

- whether hierarchy and focal point are immediately clear;
- whether alignment, spacing and whitespace create intentional relationships;
- whether typography is legible, coherent and free of overflow;
- whether color and contrast support meaning rather than add noise;
- whether repeated elements are genuinely consistent;
- whether the result feels specific to the brief rather than generically decorated;
- for interface work, whether text contrast, target size and resizing remain usable.

Separate diagnosis from mutation: decide the correction set, then execute it as one bounded phase. Prefer a few high-impact corrections over many cosmetic tweaks.

## Finish with evidence

Verify the final revision with a fresh structure query and one appropriate preview. Confirm required copy, layer editability, bounds, naming and export. Report unsupported or uncertain properties honestly rather than claiming visual parity from command success alone.
`
  }
]);

export const LIGHTTABLE_ARTIST_GUIDE_SUMMARIES = Object.freeze(
  LIGHTTABLE_ARTIST_GUIDES.map(({ id, version, uri, title, description }) => (
    { id, version, uri, title, description }
  ))
);
