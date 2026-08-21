# Repeatable Photoshop parity gates

## Authorities

- Layer Styles: `D:\mediavibe\LightTableTestFiles\psd\layer-effects-roundtrip`
- Blend/color profiles: `D:\Mediavibe\LightTableTests\BlendColorMatrix`
- Template endurance: `D:\mediavibe\LightTableTestFiles\psd\templates\Save the Date Invitation PSD 6`
- Core editable fixtures:
  `D:\mediavibe\LightTableTestFiles\RandomFiles\TextTest.psd`,
  `D:\mediavibe\LightTableTestFiles\RandomFiles\shapes.psd`, and
  `D:\FormulierPersoneel.pdf`

Photoshop reference PNGs and canonical PSDs are oracle data. LightTable output,
raw Difference, heatmaps, maximum-error samples, region metrics and JSON reports
are derived evidence. Never replace a reference because LightTable changed.

## Numeric and visual interpretation

Numeric RMSE is a triage signal, not permission to ignore a structural defect.
The blend audit therefore retains raw Difference images, amplified heatmaps,
worst samples and region metrics. Layer Style strict mode fails missing output,
runtime errors and fidelity-gate violations. Review cases remain explicitly
listed even when they are below the hard failure threshold.

All A/B comparisons use the same production Electron package, fixture, canvas
crop, profile conversion and machine. A performance optimization additionally
records active input events, submissions/encode stages, long tasks and owned GPU
bytes. Settled pixels and semantic document state remain authoritative.

## Updating a corpus

1. Generate or edit canonical cases from deterministic parameters.
2. Open the canonical PSD in Photoshop and export the declared reference PNG.
3. Record Photoshop version, profile, bit depth and effect/blend parameters in
   the manifest.
4. Run the strict LightTable audit and inspect both the contact sheet and raw
   Difference for every new case.
5. Commit generator/manifest logic separately from a renderer correction.

Generated local output belongs in the test roots or `tmp/`, not source control.
