# Face Warp / Photoshop Face-Aware Liquify parity protocol

## Purpose

This is a visual product oracle, not an attempt to reproduce undocumented
Adobe equations. LightTable and Photoshop must start from the same flattened
portrait and apply one isolated semantic edit at a time.

Adobe documents Face-Aware Liquify as working best on front-facing faces. A
profile that either product cannot detect reliably is recorded as a detection
failure, not graded as a deformation mismatch.

## Fixed corpus

Use local, redistribution-safe portraits representing:

1. frontal face at 512 px and 2048 px;
2. three-quarter face;
3. strong yaw / near profile;
4. one known detector-adverse profile.

Do not commit portrait pixels unless their redistribution licence is recorded.
Generate resolution variants with:

```powershell
node scripts/create-face-warp-resolution-fixtures.mjs <front> <three-quarter> <profile>
```

Capture the complete LightTable side (identity, eight isolated edits and native
save/reopen identity) with:

```powershell
npm run test:face-warp:parity:capture -- <portrait> <output-directory>
```

Capture a Photoshop no-op export as `photoshop-identity.png`, then place the
corresponding lossless Photoshop Face-Aware Liquify exports in that output
directory using the `photoshopFilesExpected` names from `manifest.json`.
Screen-coordinate automation is not a valid oracle: window focus, UI scaling
or an Adobe update can silently operate a different control. Enter and inspect
each isolated value in the visible Liquify UI, then run:

```powershell
npm run test:face-warp:parity:compare -- <output-directory>
```

The comparator writes raw absolute differences and, when both identity exports
exist, deformation-delta differences. Delta comparison subtracts each
application's own identity from its edited render first, so a static PNG colour
management difference cannot be mistaken for different face geometry. The
report includes raw and delta RMSE/maximum values plus per-application effect
energy. Missing Photoshop files remain explicitly `awaiting-photoshop`; they
never count as a comparison. A case pixel-identical to Photoshop's identity is
`invalid-photoshop-reference` and also cannot count as evidence.

## Isolated edits

For each accepted face, export the untouched identity and these independent
operations at +50 and -50 where Photoshop exposes an equivalent control:

- Face Width
- Eye Size, linked left/right
- Nose Width
- Smile

Use zero for every other semantic parameter. Do not combine brush sculpting
with semantic-slider parity renders.

## Capture

Photoshop:

1. Open the flattened source.
2. Convert the layer to a Smart Object so the Liquify parameters remain
   inspectable.
3. Open Filter > Liquify > Face-Aware Liquify.
4. Select the same face and enter the isolated value.
5. Export a lossless PNG at source dimensions with no display scaling.

LightTable:

1. Open the same source and run Face Warp detection once.
2. Select Adjust, Both sides and the corresponding Feature.
3. Enter the isolated Amount and export a lossless PNG at source dimensions.
4. Save the LightTable document, reopen it offline and export it again. The two
   LightTable exports must be pixel-identical.

Photoshop automation note: Adobe's supported development workflow is to record
an accepted command and copy it as JavaScript/actionJSON. Face-Aware Liquify is
recorded as opaque, source-specific `faceMeshData` rather than documented
semantic slider fields. Do not invent descriptor keys or reuse `Liquify Last
Mesh.psp` from another source portrait. Record the isolated operations in
Photoshop's UI until Adobe exposes a stable semantic descriptor.

## Evaluation

Create source / LightTable / Photoshop / absolute-difference rows. Record:

- detected face and pose acceptance;
- affected-pixel bounds;
- centroid movement for the edited feature;
- unchanged-region RMSE outside the intended feature envelope;
- full-image RMSE as supporting evidence only;
- foldovers, holes, background drag and expression discontinuities;
- whether the edit remains editable after reopen.

The comparison is reviewed visually at Fit, 100% and 300%. RMSE alone cannot
approve a face edit because two anatomically different warps can have a similar
global error.

## Release rule

Face Warp remains experimental until the fixed corpus has been captured in
both applications and representative edits are visually useful without mesh
or background artifacts. An unavailable Photoshop automation descriptor does
not justify substituting ordinary Liquify or marking the oracle complete.
