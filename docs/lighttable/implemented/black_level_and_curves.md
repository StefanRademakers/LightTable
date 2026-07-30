# Black level and Custom Curves

## Root cause

The former black-level behaviour was mathematical, not a scope bug:

- Exposure multiplies by `2 ^ EV`.
- Blacks, Shadows, Highlights and Contrast reshape log luminance, then rescale the original RGB.
- Color Grading luminance is endpoint-protected EV multiplication.
- All these operations satisfy `f(0) = 0`.

Temperature/Tint and later colour operations can also create signed channel values. Dehaze previously clamped those channels to zero before the final output. That intermediate clamp has been removed. Signed and above-one RGB are now retained until the display transform; only locally protected log/pow domains and the final display encode intentionally constrain values.

## Lift

Lift is the explicit black pedestal:

```text
pedestal = UI / 100 * 0.16
output = pedestal + input * (1 - pedestal)
```

At `+100`, exact black becomes `0.16` in linear RGB while normalized white remains `1.0`. Negative Lift permits controlled crushing. Lift runs after grading and before Curves, so it can recover low-end excursions created upstream and Curves can still deliberately reshape the result.

## Curves

Custom Curves provides Master RGB and individual R/G/B curves. Individual channels run first; Master runs second. The graph uses a display-like signed sRGB shaper around a 1024-sample `rgba32float` GPU LUT. PCHIP interpolation is smooth and does not overshoot its control-point intervals. Movable endpoints control exact black and white.

## Scope contract

After mode reads `finalTexture`, the same full-resolution display-encoded texture used by the viewport and PNG export. Compute dispatch covers image dimensions only and ignores pixels whose alpha is at most `0.001`; viewport padding is not part of the analysed texture.
