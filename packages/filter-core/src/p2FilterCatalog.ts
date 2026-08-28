import {
  numberFilterControl as number,
  selectFilterControl as select,
  type FilterControlDefinition,
} from "./filterControls";
import type { FilterPackContract } from "./filterRegistry";

export type P2FilterKind =
  | "shape-blur"
  | "smart-blur"
  | "path-blur"
  | "spin-blur"
  | "pinch"
  | "shear"
  | "glass"
  | "crystallize"
  | "mezzotint"
  | "pointillize"
  | "difference-clouds"
  | "fibers"
  | "oil-paint"
  | "glowing-edges"
  | "diffuse"
  | "solarize"
  | "custom"
  | "cutout"
  | "plastic-wrap"
  | "poster-edges"
  | "watercolor"
  | "photocopy"
  | "halftone-pattern"
  | "stamp"
  | "torn-edges"
  | "texturizer";

type UnitPoint = { x: number; y: number };
export interface P2FilterSettingsMap {
  "shape-blur": { radius: number; shape: "circle" | "diamond" | "square" };
  "smart-blur": {
    radius: number;
    threshold: number;
    quality: "low" | "medium" | "high";
    mode: "normal" | "edge-only" | "overlay";
  };
  "path-blur": { speed: number; taper: number; angle: number };
  "spin-blur": { angle: number; center: UnitPoint; feather: number };
  pinch: { amount: number; center: UnitPoint };
  shear: { amount: number; axis: "horizontal" | "vertical" };
  glass: {
    distortion: number;
    smoothness: number;
    scale: number;
    seed: number;
  };
  crystallize: { cellSize: number; seed: number };
  mezzotint: {
    type:
      | "fine-dots"
      | "medium-dots"
      | "grainy-dots"
      | "short-lines"
      | "long-lines";
    seed: number;
  };
  pointillize: { cellSize: number; seed: number };
  "difference-clouds": { scale: number; detail: number; seed: number };
  fibers: { variance: number; strength: number; seed: number };
  "oil-paint": {
    stylization: number;
    cleanliness: number;
    scale: number;
    bristleDetail: number;
  };
  "glowing-edges": { width: number; brightness: number; smoothness: number };
  diffuse: {
    mode: "normal" | "darken" | "lighten" | "anisotropic";
    amount: number;
    seed: number;
  };
  solarize: { level: number };
  custom: { kernel: number[]; scale: number; offset: number };
  cutout: { levels: number; edgeSimplicity: number; edgeFidelity: number };
  "plastic-wrap": {
    highlightStrength: number;
    detail: number;
    smoothness: number;
  };
  "poster-edges": {
    thickness: number;
    intensity: number;
    posterization: number;
  };
  watercolor: { brushDetail: number; shadowIntensity: number; texture: number };
  photocopy: { detail: number; darkness: number };
  "halftone-pattern": {
    size: number;
    contrast: number;
    pattern: "dot" | "line" | "circle";
  };
  stamp: { balance: number; smoothness: number };
  "torn-edges": { balance: number; smoothness: number; contrast: number };
  texturizer: {
    scaling: number;
    relief: number;
    light: "top" | "right" | "bottom" | "left";
    invert: "no" | "yes";
  };
}

export interface P2FilterDefinition<K extends P2FilterKind = P2FilterKind> {
  readonly kind: K;
  readonly moduleType: `lt.${K}`;
  readonly label: string;
  readonly menuLabel: string;
  readonly menuGroup:
    | "blur"
    | "blur-gallery"
    | "distort"
    | "pixelate"
    | "render"
    | "stylize"
    | "other"
    | "filter-gallery";
  readonly defaults: Readonly<P2FilterSettingsMap[K]>;
  readonly controls: readonly FilterControlDefinition[];
  readonly alphaBehavior: "preserve" | "modify" | "generate";
  readonly coordinateSpace: "layer" | "document";
}

const center = [
  number("center.x", "Center X", 0, 100, 0.1, "%"),
  number("center.y", "Center Y", 0, 100, 0.1, "%"),
] as const;
const kernelControls = Array.from({ length: 9 }, (_, index) =>
  number(
    `kernel.${index}`,
    `Kernel ${Math.floor(index / 3) + 1},${(index % 3) + 1}`,
    -999,
    999,
    0.01,
  ),
);
const def = <K extends P2FilterKind>(value: P2FilterDefinition<K>) => value;
export const P2_FILTER_DEFINITIONS = [
  def({
    kind: "shape-blur",
    moduleType: "lt.shape-blur",
    label: "Shape Blur",
    menuLabel: "Shape Blur...",
    menuGroup: "blur",
    defaults: { radius: 10, shape: "circle" },
    controls: [
      number("radius", "Radius", 0, 500, 0.1, "px"),
      select("shape", "Shape", [
        { value: "circle", label: "Circle" },
        { value: "diamond", label: "Diamond" },
        { value: "square", label: "Square" },
      ]),
    ],
    alphaBehavior: "modify",
    coordinateSpace: "document",
  }),
  def({
    kind: "smart-blur",
    moduleType: "lt.smart-blur",
    label: "Smart Blur",
    menuLabel: "Smart Blur...",
    menuGroup: "blur",
    defaults: { radius: 5, threshold: 15, quality: "medium", mode: "normal" },
    controls: [
      number("radius", "Radius", 1, 100, 0.1, "px"),
      number("threshold", "Threshold", 1, 255, 1),
      select("quality", "Quality", [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
      ]),
      select("mode", "Mode", [
        { value: "normal", label: "Normal" },
        { value: "edge-only", label: "Edge Only" },
        { value: "overlay", label: "Overlay Edge" },
      ]),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "path-blur",
    moduleType: "lt.path-blur",
    label: "Path Blur",
    menuLabel: "Path Blur...",
    menuGroup: "blur-gallery",
    defaults: { speed: 20, taper: 0, angle: 0 },
    controls: [
      number("speed", "Speed", 0, 500, 0.1, "px"),
      number("taper", "Taper", 0, 100, 1, "%"),
      number("angle", "Path Angle", -180, 180, 0.1, "deg"),
    ],
    alphaBehavior: "modify",
    coordinateSpace: "document",
  }),
  def({
    kind: "spin-blur",
    moduleType: "lt.spin-blur",
    label: "Spin Blur",
    menuLabel: "Spin Blur...",
    menuGroup: "blur-gallery",
    defaults: { angle: 15, center: { x: 50, y: 50 }, feather: 20 },
    controls: [
      number("angle", "Blur Angle", 0, 360, 0.1, "deg"),
      number("feather", "Feather", 0, 100, 1, "%"),
      ...center,
    ],
    alphaBehavior: "modify",
    coordinateSpace: "document",
  }),
  def({
    kind: "pinch",
    moduleType: "lt.pinch",
    label: "Pinch",
    menuLabel: "Pinch...",
    menuGroup: "distort",
    defaults: { amount: 50, center: { x: 50, y: 50 } },
    controls: [number("amount", "Amount", -100, 100, 1, "%"), ...center],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "shear",
    moduleType: "lt.shear",
    label: "Shear",
    menuLabel: "Shear...",
    menuGroup: "distort",
    defaults: { amount: 25, axis: "horizontal" },
    controls: [
      number("amount", "Amount", -100, 100, 0.1, "%"),
      select("axis", "Axis", [
        { value: "horizontal", label: "Horizontal" },
        { value: "vertical", label: "Vertical" },
      ]),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "glass",
    moduleType: "lt.glass",
    label: "Glass",
    menuLabel: "Glass...",
    menuGroup: "distort",
    defaults: { distortion: 5, smoothness: 3, scale: 100, seed: 1 },
    controls: [
      number("distortion", "Distortion", 0, 20, 1),
      number("smoothness", "Smoothness", 1, 15, 1),
      number("scale", "Scaling", 50, 200, 1, "%"),
      number("seed", "Seed", 0, 65535, 1),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "crystallize",
    moduleType: "lt.crystallize",
    label: "Crystallize",
    menuLabel: "Crystallize...",
    menuGroup: "pixelate",
    defaults: { cellSize: 10, seed: 1 },
    controls: [
      number("cellSize", "Cell Size", 3, 300, 1, "px"),
      number("seed", "Seed", 0, 65535, 1),
    ],
    alphaBehavior: "modify",
    coordinateSpace: "document",
  }),
  def({
    kind: "mezzotint",
    moduleType: "lt.mezzotint",
    label: "Mezzotint",
    menuLabel: "Mezzotint...",
    menuGroup: "pixelate",
    defaults: { type: "fine-dots", seed: 1 },
    controls: [
      select("type", "Type", [
        { value: "fine-dots", label: "Fine Dots" },
        { value: "medium-dots", label: "Medium Dots" },
        { value: "grainy-dots", label: "Grainy Dots" },
        { value: "short-lines", label: "Short Lines" },
        { value: "long-lines", label: "Long Lines" },
      ]),
      number("seed", "Seed", 0, 65535, 1),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "pointillize",
    moduleType: "lt.pointillize",
    label: "Pointillize",
    menuLabel: "Pointillize...",
    menuGroup: "pixelate",
    defaults: { cellSize: 8, seed: 1 },
    controls: [
      number("cellSize", "Cell Size", 3, 300, 1, "px"),
      number("seed", "Seed", 0, 65535, 1),
    ],
    alphaBehavior: "modify",
    coordinateSpace: "document",
  }),
  def({
    kind: "difference-clouds",
    moduleType: "lt.difference-clouds",
    label: "Difference Clouds",
    menuLabel: "Difference Clouds",
    menuGroup: "render",
    defaults: { scale: 128, detail: 4, seed: 1 },
    controls: [
      number("scale", "Scale", 2, 2048, 1, "px"),
      number("detail", "Detail", 1, 8, 1),
      number("seed", "Seed", 0, 65535, 1),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "fibers",
    moduleType: "lt.fibers",
    label: "Fibers",
    menuLabel: "Fibers...",
    menuGroup: "render",
    defaults: { variance: 16, strength: 4, seed: 1 },
    controls: [
      number("variance", "Variance", 1, 64, 1),
      number("strength", "Strength", 1, 64, 1),
      number("seed", "Seed", 0, 65535, 1),
    ],
    alphaBehavior: "generate",
    coordinateSpace: "document",
  }),
  def({
    kind: "oil-paint",
    moduleType: "lt.oil-paint",
    label: "Oil Paint",
    menuLabel: "Oil Paint...",
    menuGroup: "stylize",
    defaults: { stylization: 5, cleanliness: 5, scale: 1, bristleDetail: 5 },
    controls: [
      number("stylization", "Stylization", 0.1, 10, 0.1),
      number("cleanliness", "Cleanliness", 0, 10, 0.1),
      number("scale", "Scale", 0.1, 10, 0.1),
      number("bristleDetail", "Bristle Detail", 0, 10, 0.1),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "glowing-edges",
    moduleType: "lt.glowing-edges",
    label: "Glowing Edges",
    menuLabel: "Glowing Edges...",
    menuGroup: "stylize",
    defaults: { width: 2, brightness: 10, smoothness: 5 },
    controls: [
      number("width", "Edge Width", 1, 14, 1, "px"),
      number("brightness", "Edge Brightness", 0, 20, 1),
      number("smoothness", "Smoothness", 1, 15, 1),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "diffuse",
    moduleType: "lt.diffuse",
    label: "Diffuse",
    menuLabel: "Diffuse...",
    menuGroup: "stylize",
    defaults: { mode: "normal", amount: 50, seed: 1 },
    controls: [
      select("mode", "Mode", [
        { value: "normal", label: "Normal" },
        { value: "darken", label: "Darken Only" },
        { value: "lighten", label: "Lighten Only" },
        { value: "anisotropic", label: "Anisotropic" },
      ]),
      number("amount", "Amount", 0, 100, 1, "%"),
      number("seed", "Seed", 0, 65535, 1),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "solarize",
    moduleType: "lt.solarize",
    label: "Solarize",
    menuLabel: "Solarize",
    menuGroup: "stylize",
    defaults: { level: 50 },
    controls: [number("level", "Level", 0, 100, 1, "%")],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "custom",
    moduleType: "lt.custom",
    label: "Custom",
    menuLabel: "Custom...",
    menuGroup: "other",
    defaults: { kernel: [0, 0, 0, 0, 1, 0, 0, 0, 0], scale: 1, offset: 0 },
    controls: [
      ...kernelControls,
      number("scale", "Scale", -100, 100, 0.01),
      number("offset", "Offset", -255, 255, 1),
    ],
    alphaBehavior: "modify",
    coordinateSpace: "document",
  }),
  def({
    kind: "cutout",
    moduleType: "lt.cutout",
    label: "Cutout",
    menuLabel: "Cutout...",
    menuGroup: "filter-gallery",
    defaults: { levels: 4, edgeSimplicity: 4, edgeFidelity: 2 },
    controls: [
      number("levels", "Number of Levels", 2, 8, 1),
      number("edgeSimplicity", "Edge Simplicity", 0, 10, 1),
      number("edgeFidelity", "Edge Fidelity", 1, 3, 1),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "plastic-wrap",
    moduleType: "lt.plastic-wrap",
    label: "Plastic Wrap",
    menuLabel: "Plastic Wrap...",
    menuGroup: "filter-gallery",
    defaults: { highlightStrength: 15, detail: 9, smoothness: 7 },
    controls: [
      number("highlightStrength", "Highlight Strength", 0, 20, 1),
      number("detail", "Detail", 1, 15, 1),
      number("smoothness", "Smoothness", 1, 15, 1),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "poster-edges",
    moduleType: "lt.poster-edges",
    label: "Poster Edges",
    menuLabel: "Poster Edges...",
    menuGroup: "filter-gallery",
    defaults: { thickness: 1, intensity: 1, posterization: 2 },
    controls: [
      number("thickness", "Edge Thickness", 0, 10, 1),
      number("intensity", "Edge Intensity", 0, 10, 1),
      number("posterization", "Posterization", 0, 6, 1),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "watercolor",
    moduleType: "lt.watercolor",
    label: "Watercolor",
    menuLabel: "Watercolor...",
    menuGroup: "filter-gallery",
    defaults: { brushDetail: 9, shadowIntensity: 1, texture: 1 },
    controls: [
      number("brushDetail", "Brush Detail", 1, 14, 1),
      number("shadowIntensity", "Shadow Intensity", 0, 10, 1),
      number("texture", "Texture", 1, 3, 1),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "photocopy",
    moduleType: "lt.photocopy",
    label: "Photocopy",
    menuLabel: "Photocopy...",
    menuGroup: "filter-gallery",
    defaults: { detail: 2, darkness: 5 },
    controls: [
      number("detail", "Detail", 1, 24, 1),
      number("darkness", "Darkness", 1, 50, 1),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "halftone-pattern",
    moduleType: "lt.halftone-pattern",
    label: "Halftone Pattern",
    menuLabel: "Halftone Pattern...",
    menuGroup: "filter-gallery",
    defaults: { size: 1, contrast: 5, pattern: "dot" },
    controls: [
      number("size", "Size", 1, 12, 1),
      number("contrast", "Contrast", 0, 50, 1),
      select("pattern", "Pattern Type", [
        { value: "dot", label: "Dot" },
        { value: "line", label: "Line" },
        { value: "circle", label: "Circle" },
      ]),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "stamp",
    moduleType: "lt.stamp",
    label: "Stamp",
    menuLabel: "Stamp...",
    menuGroup: "filter-gallery",
    defaults: { balance: 25, smoothness: 5 },
    controls: [
      number("balance", "Light/Dark Balance", 0, 50, 1),
      number("smoothness", "Smoothness", 1, 50, 1),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "torn-edges",
    moduleType: "lt.torn-edges",
    label: "Torn Edges",
    menuLabel: "Torn Edges...",
    menuGroup: "filter-gallery",
    defaults: { balance: 25, smoothness: 11, contrast: 17 },
    controls: [
      number("balance", "Image Balance", 0, 50, 1),
      number("smoothness", "Smoothness", 1, 15, 1),
      number("contrast", "Contrast", 1, 25, 1),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
  def({
    kind: "texturizer",
    moduleType: "lt.texturizer",
    label: "Texturizer",
    menuLabel: "Texturizer...",
    menuGroup: "filter-gallery",
    defaults: { scaling: 100, relief: 4, light: "top", invert: "no" },
    controls: [
      number("scaling", "Scaling", 50, 200, 1, "%"),
      number("relief", "Relief", 0, 50, 1),
      select("light", "Light", [
        { value: "top", label: "Top" },
        { value: "right", label: "Right" },
        { value: "bottom", label: "Bottom" },
        { value: "left", label: "Left" },
      ]),
      select("invert", "Invert", [
        { value: "no", label: "Off" },
        { value: "yes", label: "On" },
      ]),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  }),
] as const;

const byKind = new Map(
  P2_FILTER_DEFINITIONS.map((definition) => [definition.kind, definition]),
);
export const isP2FilterKind = (value: unknown): value is P2FilterKind =>
  typeof value === "string" && byKind.has(value as P2FilterKind);
export const p2FilterDefinition = <K extends P2FilterKind>(
  kind: K,
): P2FilterDefinition<K> =>
  byKind.get(kind)! as unknown as P2FilterDefinition<K>;
const clone = <T>(value: T): T => structuredClone(value);
const read = (source: Record<string, unknown>, path: string) =>
  path
    .split(".")
    .reduce<unknown>(
      (v, key) =>
        v && typeof v === "object"
          ? (v as Record<string, unknown>)[key]
          : undefined,
      source,
    );
const write = (
  target: Record<string, unknown>,
  path: string,
  value: unknown,
) => {
  const parts = path.split(".");
  let owner = target;
  for (const part of parts.slice(0, -1))
    owner = owner[part] as Record<string, unknown>;
  owner[parts.at(-1)!] = value;
};
export const normalizeP2FilterSettings = <K extends P2FilterKind>(
  kind: K,
  value: unknown,
): P2FilterSettingsMap[K] => {
  const definition = p2FilterDefinition(kind);
  const result = clone(definition.defaults) as unknown as Record<
    string,
    unknown
  >;
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  for (const control of definition.controls) {
    const candidate = read(source, control.key);
    if (candidate === undefined) continue;
    if (control.type === "number") {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric))
        write(
          result,
          control.key,
          Math.min(control.max, Math.max(control.min, numeric)),
        );
    } else if (
      control.type === "select" &&
      typeof candidate === "string" &&
      control.options.some(({ value }) => value === candidate)
    )
      write(result, control.key, candidate);
  }
  if (
    kind === "custom" &&
    Array.isArray(source.kernel) &&
    source.kernel.length === 9 &&
    source.kernel.every(Number.isFinite)
  )
    result.kernel = source.kernel.map(Number);
  return result as P2FilterSettingsMap[K];
};
export const defaultP2FilterSettings = <K extends P2FilterKind>(kind: K) =>
  normalizeP2FilterSettings(kind, p2FilterDefinition(kind).defaults);
export const P2_FILTER_PACK: FilterPackContract<P2FilterDefinition> =
  Object.freeze({
    id: "p2",
    maturity: "experimental",
    definitions: P2_FILTER_DEFINITIONS,
    normalize: (kind: string, value: unknown) => {
      if (!isP2FilterKind(kind))
        throw new Error(`Unknown P2 filter kind: ${kind}`);
      return normalizeP2FilterSettings(kind, value);
    },
  });
