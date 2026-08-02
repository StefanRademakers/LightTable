# LightTable scopes

LightTable exposes Histogram, RGB Parade and Vectorscope together in a vertical column next to the adjustment panel.

## Source

Every visible scope follows the viewport Before/After selection:

- Before reads untouched `sourceTexture` (`rgba8unorm`).
- After reads the final display-encoded `finalTexture` (`rgba8unorm`), including Grain when enabled.

The Parade and Vectorscope are output consumers. They do not participate in `FINAL_COLOR_WGSL`, modify an image texture or trigger adjustment passes. Histogram currently copies its 768 GPU counters to CPU for its existing Canvas 2D graph. Parade and Vectorscope remain GPU-only.

The Vectorscope applies a BT.709 Y'CbCr matrix directly to display-encoded sRGB values. sRGB and Rec.709 use the same primaries but not the same transfer curve, so this is an sRGB output scope rather than a strict Rec.709 video-signal scope.

## GPU passes

- Histogram: one compute pass and a small 768-counter readback when visible and dirty.
- Parade only: one analysis compute pass and one display render pass.
- Vectorscope only: one analysis compute pass and one display render pass.
- Parade and Vectorscope: one shared analysis compute pass and two display render passes.
- All scopes hidden: no scope buffer clears, compute passes, render passes or scope readbacks.

Trace brightness does not rerun the image pipeline. Tonal range and quality changes invalidate only scope analysis. A changed final image marks visible scopes dirty after the final texture has been rendered. The Vectorscope uses the default graticule, skin-tone reference and absolute 1x chroma scale without exposing extra checkboxes in the compact scope column.

## Sampling

Scopes use an aspect-preserving, whole-image sampling grid. The UI uses the fixed Medium default; the internal Low/High/Auto modes remain available to the renderer for future tuning but are not exposed as editor controls.

- Low: about `256 x 256` samples; Auto uses this during slider drags.
- Medium: about `512 x 512` samples and the current editor default.
- High: about `1024 x 1024` samples; Auto uses this after interaction.

No central crop is used. The compute shader maps every sample-cell centre back across the complete source dimensions.

## RGB Parade

The Parade stores `3 x 256 x 256` atomic counters. Source X remains horizontal; source Y is accumulated. Values 0 and 1 map to the bottom and top respectively. The fixed displayed scale runs from 0 to 100 percent; the analysed texture remains 8-bit normalized output.

## Vectorscope

The Vectorscope stores `256 x 256` atomic counters and uses:

```text
Y' = 0.2126 R' + 0.7152 G' + 0.0722 B'
Cb = (B' - Y') / 1.8556
Cr = (R' - Y') / 1.5748
```

Cb runs horizontally and positive Cr points upward. Neutral pixels land in the centre. The six 75% targets are calculated through the same conversion. The optional 123-degree skin-tone line is a hue reference, not a skin detector.

## Differences from Resolve

- The MVP analyses display-encoded sRGB output instead of a selectable Rec.709 video transfer mode.
- It currently has RGB Parade only, without YRGB/Y'CbCr modes, low-pass or raw extents.
- Vectorscope trace gain is log-density with a lightweight display filter; it does not reproduce Resolve's proprietary trace processing.
- ICC normalization, a float scope source and an explicit pre-Grain source can be added later.
