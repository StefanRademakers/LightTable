/**
 * Gradient Map WGSL fragment shared by the creative adjustment pass.
 * It intentionally depends on the pass' Adjustments uniform plus luminance,
 * linearToCurveDomain and curveDomainToLinear helpers.
 */
export const GRADIENT_MAP_WGSL = /* wgsl */ `
fn gradientMidpointAmount(amount: f32, midpoint: f32) -> f32 {
  let middle = clamp(midpoint, 0.01, 0.99);
  return select(
    0.5 * amount / middle,
    0.5 + 0.5 * (amount - middle) / (1.0 - middle),
    amount >= middle
  );
}

fn photoshopClassicGradientAmount(amount: f32) -> f32 {
  return amount + 0.5 * amount * (1.0 - amount) * (2.0 * amount - 1.0);
}

fn gradientMapColorAt(position: f32) -> vec3f {
  let count = u32(adjustments.gradientMapControls.y + 0.5);
  if (count == 0u) { return vec3f(position); }
  var lower = 0u;
  var upper = count - 1u;
  for (var index = 0u; index < 8u; index += 1u) {
    if (index < count && adjustments.gradientMapColors[index].w <= position) { lower = index; }
    if (index < count && adjustments.gradientMapColors[index].w >= position) { upper = min(upper, index); }
  }
  let first = adjustments.gradientMapColors[lower];
  let second = adjustments.gradientMapColors[upper];
  var amount = select(
    clamp((position - first.w) / max(second.w - first.w, 1e-6), 0.0, 1.0),
    0.0,
    lower == upper
  );
  let flags = u32(adjustments.gradientMapControls.w + 0.5);
  let midpoint = select(adjustments.gradientMapOpacity[lower].w, adjustments.gradientMapOpacity[upper].w, (flags & 16u) != 0u);
  amount = gradientMidpointAmount(amount, midpoint);
  if ((flags & 16u) != 0u) { amount = photoshopClassicGradientAmount(amount); }
  return vec3f(
    curveDomainToLinear(mix(first.r, second.r, amount)),
    curveDomainToLinear(mix(first.g, second.g, amount)),
    curveDomainToLinear(mix(first.b, second.b, amount))
  );
}

fn gradientMapOpacityAt(position: f32) -> f32 {
  let count = u32(adjustments.gradientMapControls.z + 0.5);
  if (count == 0u) { return 1.0; }
  var lower = 0u;
  var upper = count - 1u;
  for (var index = 0u; index < 8u; index += 1u) {
    if (index < count && adjustments.gradientMapOpacity[index].x <= position) { lower = index; }
    if (index < count && adjustments.gradientMapOpacity[index].x >= position) { upper = min(upper, index); }
  }
  let first = adjustments.gradientMapOpacity[lower];
  let second = adjustments.gradientMapOpacity[upper];
  var amount = select(
    clamp((position - first.x) / max(second.x - first.x, 1e-6), 0.0, 1.0),
    0.0,
    lower == upper
  );
  let flags = u32(adjustments.gradientMapControls.w + 0.5);
  let midpoint = select(first.z, second.z, (flags & 16u) != 0u);
  amount = gradientMidpointAmount(amount, midpoint);
  return mix(first.y, second.y, amount);
}

fn applyGradientMap(rgb: vec3f, pixel: vec2f) -> vec3f {
  if (adjustments.gradientMapControls.x < 0.5) { return rgb; }
  let flags = u32(adjustments.gradientMapControls.w + 0.5);
  var position = clamp(linearToCurveDomain(max(luminance(rgb), 0.0)), 0.0, 1.0);
  if ((flags & 16u) != 0u) {
    position = clamp(photoshopBlendLuminosity(photoshopLinearSrgbToEncodedDocument(rgb)), 0.0, 1.0);
  }
  if ((flags & 2u) != 0u) {
    let noise = fract(sin(dot(pixel, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
    position = clamp(position + noise / 255.0, 0.0, 1.0);
  }
  if ((flags & 1u) != 0u) { position = 1.0 - position; }
  let mapped = gradientMapColorAt(position);
  let opacity = gradientMapOpacityAt(position);
  if ((flags & 16u) != 0u) {
    let encodedSource = photoshopLinearSrgbToEncodedDocument(rgb);
    let encodedMapped = photoshopLinearSrgbToEncodedDocument(mapped);
    return photoshopEncodedDocumentToLinearSrgb(mix(encodedSource, encodedMapped, opacity));
  }
  return mix(rgb, mapped, opacity);
}
`;
