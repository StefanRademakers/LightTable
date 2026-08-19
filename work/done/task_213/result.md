# Result — Color and Vibrance compatibility repair

The unsupported CAT16 parity claim has been replaced by a complete measured
Photoshop Beta 27.11 comparison and a bounded compatibility implementation.
No single `1 - RMSE` percentage is used as proof.

## Product result

- Temperature/Tint now follows a coupled 21 × 21 measured slider surface with
  9³ RGB volumes and explicit temporary headroom.
- When white balance and color sliders are combined, a measured 17³ color stage
  preserves Photoshop's operation order instead of clipping between stages.
- Isolated Vibrance/Saturation retains the already good analytic OKLab,
  skin-like protection and gamut response from task 211.
- The asset is a separate lazy 1.686.678-byte binary. It is not TypeScript,
  Base64 or initial JavaScript. Per active layer the two GPU volumes use about
  22 KB.
- The former calibration held 6.136.221 binary bytes and generated 8.59 MB of
  TypeScript. Binary storage is now 72.5% smaller while producing materially
  better complete-node results than the CAT16 replacement.

## Current Photoshop comparison

Lower RGB RMSE is better. These are not percentages of matching pixels.

| Group | Cases | Mean RGB RMSE | Worst RGB RMSE |
| --- | ---: | ---: | ---: |
| Temperature | 6 signed core | 1.663% | 2.416% |
| Tint | 6 signed core | 1.633% | 3.005% |
| Vibrance | 6 signed core | 2.053% | 4.622% |
| Saturation | 6 signed core | 0.292% | 0.583% |
| Combined ±80 | 2 | 1.362% | 1.611% |
| Held-out mixed | 13 | 1.770% | 4.177% |
| Synthetic color lattice, Temperature | 6 | 1.062% | 1.379% |
| Synthetic color lattice, Tint | 6 | 1.003% | 1.396% |
| Second photograph, combined ±80 | 2 | 2.197% | 3.451% |

The original complete portrait baseline was 18.462% Temperature and 8.223%
Tint mean RGB RMSE. The first compact implementation still produced 15.385%
on combined +80 because it clipped before Vibrance/Saturation; the accepted
two-stage implementation reduces that case to 1.114% on the primary portrait.

Known non-identical areas remain: Vibrance −100 is the weakest isolated core
case at 4.622%, held-out combined random B is 4.177%, and the strongly warm,
saturated second photograph at combined +80 is 3.451% with localized clipped
pixels. The contact sheets are visually close but this is not pixel parity.

## Verification

- Photoshop Beta 27.11 executable and source hashes are bound into each report.
- Packaged Electron/WebGPU rendered all 40 primary cases, 13 synthetic cases,
  and the two second-photograph cases.
- App typecheck passed.
- 446 app test files / 2,491 tests passed in the corrective run; the complete
  workspace test command also passed.
- Desktop package and distribution-boundary verification passed.
- Web production build and delivery audit passed at 2.981.265 bytes initial
  JavaScript and 302.244 bytes CSS; the compatibility binary is classified lazy.

Reports live outside the repository under
`D:\mediavibe\LightTableTests\AdjustmentParity\color-vibrance-*-complete\report`
and `color-vibrance-people-16\report`.

Darktable was used as design reference, not copied: its code reinforced the
separation between RAW illuminant adaptation, display-referred correction and
perceptual gamut handling. It also helped reject treating this rendered-pixel
Photoshop adjustment as a direct Kelvin/CAT16 control.

## Native Grade correction

The first completion was incomplete: it repaired the Photoshop-shaped
adjustment layer but left native Grade Temperature/Tint on the rejected CAT16
implementation. The correction now routes document Grade, Grade layers and
local raster grades through the same measured rendered-pixel white-balance
core. Native Grade keeps its existing Camera Raw-oriented Vibrance/Saturation
formula; a trial that also shared the Photoshop color model regressed
Saturation and was removed.

The lazy binary starts loading when a native Grade layer is realized, rather
than on its first Temperature/Tint gesture. This avoids a correctness race in
which the first extreme frame/export used the analytic fallback while later
values used the measured model. PNG export also waits at the lazy-asset
boundary and forces a final payload sync before readback.

Current packaged Camera Raw 18.5 corpus, 11 sources and 33 isolated cases per
source (363 outputs per product):

| Control | Active sources | Minimum source correlation | Mean magnitude | Worst delta RMSE | Worst source |
| --- | ---: | ---: | ---: | ---: | --- |
| Temperature | 8/11 | 0.9849 | 1.018 | 4.42% | wide-gamut-color |
| Tint | 8/11 | 0.9209 | 1.072 | 6.41% | wide-gamut-color |
| Vibrance | 8/11 | 0.7371 | 1.353 | 15.54% | wide-gamut-color |
| Saturation | 8/11 | 0.9281 | 0.980 | 8.32% | color-target |

Before this correction, Temperature had 33.97% worst RMSE and 0.3885 minimum
source correlation; Tint had 17.81% and 0.3916. Vibrance and Saturation are
unchanged and remain open native Grade model risks. No aggregate parity
percentage is claimed.
