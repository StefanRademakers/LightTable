import type { PointColorSample } from '../pointColor';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const pointColorAxisWeight = (distance: number, radius: number) => {
  const normalized = distance / Math.max(radius, 0.00001);
  return 1 - smoothstep(0.55, 1, normalized);
};

/** CPU oracle for the exact selection-weight function shared by Grade WGSL. */
export const pointColorSelectionWeight = (
  lightness: number,
  chroma: number,
  hue: number,
  sample: Pick<PointColorSample,
    'lightness' | 'chroma' | 'hue' | 'range' | 'hueRange' | 'saturationRange' | 'luminanceRange'>
) => {
  const reach = 0.35 + clamp01(sample.range / 100) * 1.65;
  const hueRadius = Math.min(
    Math.PI,
    (0.035 + (Math.PI - 0.035) * clamp01(sample.hueRange / 100)) * reach
  );
  const chromaRadius = (0.008 + (0.35 - 0.008)
    * clamp01(sample.saturationRange / 100)) * reach;
  const lightnessRadius = (0.015 + (0.75 - 0.015)
    * clamp01(sample.luminanceRange / 100)) * reach;
  const hueDelta = Math.atan2(
    Math.sin(hue - sample.hue),
    Math.cos(hue - sample.hue)
  );
  return pointColorAxisWeight(Math.abs(hueDelta), hueRadius)
    * pointColorAxisWeight(Math.abs(chroma - sample.chroma), chromaRadius)
    * pointColorAxisWeight(Math.abs(lightness - sample.lightness), lightnessRadius);
};

/** Pure selection code reused by Grade evaluation and the viewport diagnostic. */
export const POINT_COLOR_SELECTION_WGSL = /* wgsl */ `
fn pointColorAxisWeight(distance: f32, radius: f32) -> f32 {
  let normalized = distance / max(radius, 0.00001);
  return 1.0 - smoothstep(0.55, 1.0, normalized);
}

fn pointColorSelectionWeight(lab: vec3f, sample: vec4f, selection: vec4f) -> f32 {
  let chroma = length(lab.yz);
  let hue = atan2(lab.z, lab.y);
  let reach = 0.35 + clamp(selection.x / 100.0, 0.0, 1.0) * 1.65;
  let hueRadius = min(3.1415926536, mix(0.035, 3.1415926536, clamp(selection.y / 100.0, 0.0, 1.0)) * reach);
  let chromaRadius = mix(0.008, 0.35, clamp(selection.z / 100.0, 0.0, 1.0)) * reach;
  let lightnessRadius = mix(0.015, 0.75, clamp(selection.w / 100.0, 0.0, 1.0)) * reach;
  let hueDelta = atan2(sin(hue - sample.z), cos(hue - sample.z));
  return
    pointColorAxisWeight(abs(hueDelta), hueRadius)
    * pointColorAxisWeight(abs(chroma - sample.y), chromaRadius)
    * pointColorAxisWeight(abs(lab.x - sample.x), lightnessRadius);
}
`;
