# StoryBuilder adapter test plan

## Commands

From `D:\mediavibe\StoryBuilderOnline\client`:

- `npm run dev` uses the legacy rollback runtime.
- `npm run dev:lighttable` uses extracted LightTable source with HMR.
- `npm run build` verifies the legacy production route.
- `npm run build:lighttable` verifies the vendored extracted route.

Web editor and CSS changes hot-update in both Vite hosts. Electron renderer
changes hot-update through Electron Forge/Vite. Electron main, preload and
packaging changes require an Electron restart.

## Functional comparison

Run the same source through legacy StoryBuilder, extracted StoryBuilder,
standalone web and Electron where applicable:

- Open ordinary PNG/JPEG and verify initial color and dimensions.
- Open 16-bit TIFF and verify decoder/status metadata.
- Open a layered LightTable document and verify layers, masks and styles.
- Open PSD fixtures and verify order, pixels, groups, clipping and reports.
- Exercise sliders, scopes, brushes, selection, transform and auto-align.
- Copy/paste a grade and compare direct-save with edit-before-save.
- Save a flat correction through the global upload manager.
- Save and reopen a layered document.
- Verify mediaboard, GenAI history, shots filmstrip and variants lightbox.
- Verify errors appear in the status/debug UI and do not close the editor.

Do not delete the StoryBuilder-local runtime until this list is signed off.
