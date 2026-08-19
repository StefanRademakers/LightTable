# Result

Color and Vibrance no longer ships a calibration LUT library. Temperature and
Tint use CAT16 chromatic adaptation; Vibrance and Saturation operate in OKLab
with low-saturation response, a soft OKLCH skin-like mask and continuous gamut
projection from the same-lightness neutral axis.

## Delivery and runtime

- Removed generated TypeScript: 8,591,289 bytes.
- Removed embedded binary calibration data: 6,136,221 bytes.
- Removed two per-layer 13x13x13 GPU textures and slider-time texture uploads.
- Initial web JavaScript fell from 11,093.37 kB / 4,797.58 kB gzip to
  2,848.00 kB / 760.26 kB gzip. The final file is 2,848,006 bytes raw and
  594,077 bytes Brotli: 74.3% less raw and 84.2% less gzip than the baseline.
- Neutral bypasses all Color and Vibrance math exactly.

## Visual evidence

- All 27 diagnostic cases rendered through the packaged Electron/WebGPU path:
  neutral; signed 20/80/100 for every slider; combined signed 80 extremes.
- Smooth gradients exposed contouring in the first six-step gamut prototype.
  It was replaced by continuous neutral-axis projection; the final +100
  Saturation and combined +80 gradients are visually smooth.
- A dedicated `D:\face.jpg` corpus isolates neutral, Vibrance +20/+80/+100 and
  Saturation +80/+100. All six cases pass the historical 95% diagnostic gate;
  aggregate parity is 99.253%, though compatibility is no longer the contract.
- At Vibrance +100, encoded RGB chroma in the sampled skin ROI changes from
  0.129 to 0.171, versus Photoshop 0.195. The grass ROI changes from 0.055 to
  0.135, versus Photoshop 0.146. The new default is deliberately slightly more
  protective of skin while still lifting muted background color strongly.
- Saturation +100 remains global: skin ROI 0.262 versus Photoshop 0.266.

## Reusable lesson

The protection parameters and CPU reference live in `colorVibranceModel.ts`.
They are suitable input to task 212's native Grade experiment, but the mask is
a broad chromatic likelihood—not semantic skin/person recognition—and still
needs a more diverse portrait and saturated-object corpus before reuse.

## Verification

- App test suite: 82 files, 2,617 tests passed.
- App typecheck, structural-audit policy and production web build passed.
- Source-structure and web-delivery audits passed with zero accountable
  generated source artifacts.
- Verified desktop packaging passed; the final shader rendered successfully
  through the packaged Electron/WebGPU path.
