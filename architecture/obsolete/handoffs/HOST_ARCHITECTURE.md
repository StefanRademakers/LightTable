# Host architecture

`@lighttable/app` owns the editor, WebGPU processing, document model, UI, CSS,
icons, tests and workers. It does not know where media is stored.

Hosts implement `LightTableHost`:

- `web`: browser file input and browser download.
- `electron`: native file dialogs and filesystem writes through a narrow
  sandboxed preload bridge.
- `storybuilder`: adapter for authenticated S3-backed reads and StoryBuilder's
  existing upload/save flows.

The StoryBuilder adapter belongs at the integration boundary. LightTable may
request media through `LightTableMediaBrowser`, but must never import
StoryBuilder state, API clients, routes or storage keys.

## StoryBuilder migration boundary

StoryBuilder imports one runtime facade. Its normal production build currently
aliases that facade to the old local implementation. The extracted comparison
build aliases it to `@lighttable/app`, with a thin adapter that:

- loads original media through StoryBuilder's authenticated API;
- resolves recipe metadata through StoryBuilder's API;
- leaves uploads, shot variants and mediaboard placement with StoryBuilder;
- passes only bytes, names, settings and save callbacks across the boundary.

The extracted production build consumes a versioned tarball in
`client/vendor`, so it does not require this sibling checkout on the server.
The extracted development mode aliases `@lighttable/app` directly to this
repository for HMR.

Only remove the duplicated StoryBuilder source after image, PSD,
layered-document, direct grade-paste and save/upload workflows pass in both
hosts.
