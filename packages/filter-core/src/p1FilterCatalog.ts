import {
  numberFilterControl as number,
  selectFilterControl as select,
  type FilterControlDefinition,
} from "./filterControls";
import type { FilterPackContract } from "./filterRegistry";
import type { FilterEdgeMode } from "./p0FilterCatalog";

export type P1FilterKind =
  | "box-blur"
  | "radial-blur"
  | "field-blur"
  | "iris-blur"
  | "tilt-shift"
  | "wave"
  | "ripple"
  | "twirl"
  | "spherize"
  | "polar-coordinates"
  | "dust-scratches"
  | "despeckle"
  | "mosaic"
  | "color-halftone"
  | "clouds"
  | "lens-flare"
  | "find-edges"
  | "emboss";

type UnitPoint = { x: number; y: number };

export interface P1FilterSettingsMap {
  "box-blur": { radius: number };
  "radial-blur": {
    amount: number;
    method: "spin" | "zoom";
    quality: "draft" | "good" | "best";
    center: UnitPoint;
  };
  "field-blur": {
    radius: number;
    center: UnitPoint;
    focus: number;
    feather: number;
  };
  "iris-blur": {
    radius: number;
    center: UnitPoint;
    irisRadius: number;
    feather: number;
  };
  "tilt-shift": {
    radius: number;
    center: UnitPoint;
    bandSize: number;
    feather: number;
    angle: number;
  };
  wave: {
    amount: number;
    wavelength: number;
    phase: number;
    waveType: "sine" | "triangle";
    edgeMode: FilterEdgeMode;
  };
  ripple: {
    amount: number;
    size: "small" | "medium" | "large";
    center: UnitPoint;
  };
  twirl: { angle: number; radius: number; center: UnitPoint };
  spherize: {
    amount: number;
    mode: "normal" | "horizontal" | "vertical";
    center: UnitPoint;
  };
  "polar-coordinates": {
    mode: "rectangular-to-polar" | "polar-to-rectangular";
  };
  "dust-scratches": { radius: number; threshold: number };
  despeckle: { strength: number };
  mosaic: { cellSize: number };
  "color-halftone": {
    radius: number;
    angle1: number;
    angle2: number;
    angle3: number;
    angle4: number;
  };
  clouds: { scale: number; detail: number; seed: number };
  "lens-flare": {
    brightness: number;
    lensType: "50-300mm" | "35mm" | "105mm" | "movie-prime";
    center: UnitPoint;
  };
  "find-edges": { amount: number };
  emboss: { angle: number; height: number; amount: number };
}

export interface P1FilterDefinition<K extends P1FilterKind = P1FilterKind> {
  readonly kind: K;
  readonly moduleType: `lt.${K}`;
  readonly label: string;
  readonly menuLabel: string;
  readonly menuGroup:
    | "blur"
    | "blur-gallery"
    | "distort"
    | "noise"
    | "pixelate"
    | "render"
    | "stylize";
  readonly defaults: Readonly<P1FilterSettingsMap[K]>;
  readonly controls: readonly FilterControlDefinition[];
  readonly alphaBehavior: "preserve" | "modify" | "generate";
  readonly coordinateSpace: "layer" | "document";
}

const centerControls = [
  number("center.x", "Center X", 0, 100, 0.1, "%"),
  number("center.y", "Center Y", 0, 100, 0.1, "%"),
] as const;
const edgeOptions = [
  { value: "transparent", label: "Transparent" },
  { value: "clamp", label: "Repeat Edge Pixels" },
  { value: "wrap", label: "Wrap Around" },
] as const;

export const P1_FILTER_DEFINITIONS = [
  {
    kind: "box-blur",
    moduleType: "lt.box-blur",
    label: "Box Blur",
    menuLabel: "Box Blur...",
    menuGroup: "blur",
    defaults: { radius: 4 },
    controls: [number("radius", "Radius", 0, 500, 0.1, "px")],
    alphaBehavior: "modify",
    coordinateSpace: "document",
  },
  {
    kind: "radial-blur",
    moduleType: "lt.radial-blur",
    label: "Radial Blur",
    menuLabel: "Radial Blur...",
    menuGroup: "blur",
    defaults: {
      amount: 10,
      method: "spin",
      quality: "good",
      center: { x: 50, y: 50 },
    },
    controls: [
      number("amount", "Amount", 0, 100, 1),
      select("method", "Method", [
        { value: "spin", label: "Spin" },
        { value: "zoom", label: "Zoom" },
      ]),
      select("quality", "Quality", [
        { value: "draft", label: "Draft" },
        { value: "good", label: "Good" },
        { value: "best", label: "Best" },
      ]),
      ...centerControls,
    ],
    alphaBehavior: "modify",
    coordinateSpace: "document",
  },
  {
    kind: "field-blur",
    moduleType: "lt.field-blur",
    label: "Field Blur",
    menuLabel: "Field Blur...",
    menuGroup: "blur-gallery",
    defaults: { radius: 15, center: { x: 50, y: 50 }, focus: 0, feather: 50 },
    controls: [
      number("radius", "Blur", 0, 500, 0.1, "px"),
      number("focus", "Focus", 0, 100, 1, "%"),
      number("feather", "Feather", 0, 100, 1, "%"),
      ...centerControls,
    ],
    alphaBehavior: "modify",
    coordinateSpace: "document",
  },
  {
    kind: "iris-blur",
    moduleType: "lt.iris-blur",
    label: "Iris Blur",
    menuLabel: "Iris Blur...",
    menuGroup: "blur-gallery",
    defaults: {
      radius: 15,
      center: { x: 50, y: 50 },
      irisRadius: 25,
      feather: 50,
    },
    controls: [
      number("radius", "Blur", 0, 500, 0.1, "px"),
      number("irisRadius", "Iris Radius", 0, 100, 0.1, "%"),
      number("feather", "Feather", 0, 100, 1, "%"),
      ...centerControls,
    ],
    alphaBehavior: "modify",
    coordinateSpace: "document",
  },
  {
    kind: "tilt-shift",
    moduleType: "lt.tilt-shift",
    label: "Tilt-Shift",
    menuLabel: "Tilt-Shift...",
    menuGroup: "blur-gallery",
    defaults: {
      radius: 15,
      center: { x: 50, y: 50 },
      bandSize: 25,
      feather: 20,
      angle: 0,
    },
    controls: [
      number("radius", "Blur", 0, 500, 0.1, "px"),
      number("bandSize", "In-Focus Area", 0, 100, 0.1, "%"),
      number("feather", "Feather", 0, 100, 1, "%"),
      number("angle", "Angle", -180, 180, 0.1, "deg"),
      ...centerControls,
    ],
    alphaBehavior: "modify",
    coordinateSpace: "document",
  },
  {
    kind: "wave",
    moduleType: "lt.wave",
    label: "Wave",
    menuLabel: "Wave...",
    menuGroup: "distort",
    defaults: {
      amount: 10,
      wavelength: 64,
      phase: 0,
      waveType: "sine",
      edgeMode: "clamp",
    },
    controls: [
      number("amount", "Amplitude", -999, 999, 0.1, "px"),
      number("wavelength", "Wavelength", 2, 999, 0.1, "px"),
      number("phase", "Phase", -180, 180, 0.1, "deg"),
      select("waveType", "Type", [
        { value: "sine", label: "Sine" },
        { value: "triangle", label: "Triangle" },
      ]),
      select("edgeMode", "Undefined Areas", edgeOptions),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  },
  {
    kind: "ripple",
    moduleType: "lt.ripple",
    label: "Ripple",
    menuLabel: "Ripple...",
    menuGroup: "distort",
    defaults: { amount: 100, size: "medium", center: { x: 50, y: 50 } },
    controls: [
      number("amount", "Amount", -999, 999, 1, "%"),
      select("size", "Size", [
        { value: "small", label: "Small" },
        { value: "medium", label: "Medium" },
        { value: "large", label: "Large" },
      ]),
      ...centerControls,
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  },
  {
    kind: "twirl",
    moduleType: "lt.twirl",
    label: "Twirl",
    menuLabel: "Twirl...",
    menuGroup: "distort",
    defaults: { angle: 50, radius: 50, center: { x: 50, y: 50 } },
    controls: [
      number("angle", "Angle", -999, 999, 0.1, "deg"),
      number("radius", "Radius", 1, 100, 0.1, "%"),
      ...centerControls,
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  },
  {
    kind: "spherize",
    moduleType: "lt.spherize",
    label: "Spherize",
    menuLabel: "Spherize...",
    menuGroup: "distort",
    defaults: { amount: 100, mode: "normal", center: { x: 50, y: 50 } },
    controls: [
      number("amount", "Amount", -100, 100, 1, "%"),
      select("mode", "Mode", [
        { value: "normal", label: "Normal" },
        { value: "horizontal", label: "Horizontal Only" },
        { value: "vertical", label: "Vertical Only" },
      ]),
      ...centerControls,
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  },
  {
    kind: "polar-coordinates",
    moduleType: "lt.polar-coordinates",
    label: "Polar Coordinates",
    menuLabel: "Polar Coordinates...",
    menuGroup: "distort",
    defaults: { mode: "rectangular-to-polar" },
    controls: [
      select("mode", "Conversion", [
        { value: "rectangular-to-polar", label: "Rectangular to Polar" },
        { value: "polar-to-rectangular", label: "Polar to Rectangular" },
      ]),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  },
  {
    kind: "dust-scratches",
    moduleType: "lt.dust-scratches",
    label: "Dust & Scratches",
    menuLabel: "Dust & Scratches...",
    menuGroup: "noise",
    defaults: { radius: 2, threshold: 10 },
    controls: [
      number("radius", "Radius", 1, 100, 1, "px"),
      number("threshold", "Threshold", 0, 255, 1),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  },
  {
    kind: "despeckle",
    moduleType: "lt.despeckle",
    label: "Despeckle",
    menuLabel: "Despeckle",
    menuGroup: "noise",
    defaults: { strength: 50 },
    controls: [number("strength", "Strength", 0, 100, 1, "%")],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  },
  {
    kind: "mosaic",
    moduleType: "lt.mosaic",
    label: "Mosaic",
    menuLabel: "Mosaic...",
    menuGroup: "pixelate",
    defaults: { cellSize: 10 },
    controls: [number("cellSize", "Cell Size", 2, 500, 1, "px")],
    alphaBehavior: "modify",
    coordinateSpace: "document",
  },
  {
    kind: "color-halftone",
    moduleType: "lt.color-halftone",
    label: "Color Halftone",
    menuLabel: "Color Halftone...",
    menuGroup: "pixelate",
    defaults: { radius: 8, angle1: 108, angle2: 162, angle3: 90, angle4: 45 },
    controls: [
      number("radius", "Max Radius", 2, 127, 1, "px"),
      number("angle1", "Channel 1", -180, 180, 0.1, "deg"),
      number("angle2", "Channel 2", -180, 180, 0.1, "deg"),
      number("angle3", "Channel 3", -180, 180, 0.1, "deg"),
      number("angle4", "Channel 4", -180, 180, 0.1, "deg"),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  },
  {
    kind: "clouds",
    moduleType: "lt.clouds",
    label: "Clouds",
    menuLabel: "Clouds",
    menuGroup: "render",
    defaults: { scale: 128, detail: 4, seed: 1 },
    controls: [
      number("scale", "Scale", 2, 2048, 1, "px"),
      number("detail", "Detail", 1, 8, 1),
      number("seed", "Seed", 0, 65535, 1),
    ],
    alphaBehavior: "generate",
    coordinateSpace: "document",
  },
  {
    kind: "lens-flare",
    moduleType: "lt.lens-flare",
    label: "Lens Flare",
    menuLabel: "Lens Flare...",
    menuGroup: "render",
    defaults: {
      brightness: 100,
      lensType: "50-300mm",
      center: { x: 50, y: 50 },
    },
    controls: [
      number("brightness", "Brightness", 10, 300, 1, "%"),
      select("lensType", "Lens Type", [
        { value: "50-300mm", label: "50-300mm Zoom" },
        { value: "35mm", label: "35mm Prime" },
        { value: "105mm", label: "105mm Prime" },
        { value: "movie-prime", label: "Movie Prime" },
      ]),
      ...centerControls,
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  },
  {
    kind: "find-edges",
    moduleType: "lt.find-edges",
    label: "Find Edges",
    menuLabel: "Find Edges",
    menuGroup: "stylize",
    defaults: { amount: 100 },
    controls: [number("amount", "Amount", 0, 100, 1, "%")],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  },
  {
    kind: "emboss",
    moduleType: "lt.emboss",
    label: "Emboss",
    menuLabel: "Emboss...",
    menuGroup: "stylize",
    defaults: { angle: 135, height: 3, amount: 100 },
    controls: [
      number("angle", "Angle", -180, 180, 0.1, "deg"),
      number("height", "Height", 1, 10, 1, "px"),
      number("amount", "Amount", 1, 500, 1, "%"),
    ],
    alphaBehavior: "preserve",
    coordinateSpace: "document",
  },
] as const satisfies readonly P1FilterDefinition[];

const byKind = new Map(
  P1_FILTER_DEFINITIONS.map((definition) => [definition.kind, definition]),
);
export const isP1FilterKind = (value: unknown): value is P1FilterKind =>
  typeof value === "string" && byKind.has(value as P1FilterKind);

const finite = (value: unknown, fallback: number) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value: unknown, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, finite(value, fallback)));
const integer = (value: unknown, fallback: number, min: number, max: number) =>
  Math.round(clamp(value, fallback, min, max));
const choice = <T extends string>(
  value: unknown,
  values: readonly T[],
  fallback: T,
): T =>
  typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : fallback;
const point = (value: unknown): UnitPoint => {
  const source =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return { x: clamp(source.x, 50, 0, 100), y: clamp(source.y, 50, 0, 100) };
};

export const normalizeP1FilterSettings = <K extends P1FilterKind>(
  kind: K,
  value: unknown,
): P1FilterSettingsMap[K] => {
  const s =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  switch (kind) {
    case "box-blur":
      return { radius: clamp(s.radius, 4, 0, 500) } as P1FilterSettingsMap[K];
    case "radial-blur":
      return {
        amount: clamp(s.amount, 10, 0, 100),
        method: choice(s.method, ["spin", "zoom"], "spin"),
        quality: choice(s.quality, ["draft", "good", "best"], "good"),
        center: point(s.center),
      } as P1FilterSettingsMap[K];
    case "field-blur":
      return {
        radius: clamp(s.radius, 15, 0, 500),
        center: point(s.center),
        focus: clamp(s.focus, 0, 0, 100),
        feather: clamp(s.feather, 50, 0, 100),
      } as P1FilterSettingsMap[K];
    case "iris-blur":
      return {
        radius: clamp(s.radius, 15, 0, 500),
        center: point(s.center),
        irisRadius: clamp(s.irisRadius, 25, 0, 100),
        feather: clamp(s.feather, 50, 0, 100),
      } as P1FilterSettingsMap[K];
    case "tilt-shift":
      return {
        radius: clamp(s.radius, 15, 0, 500),
        center: point(s.center),
        bandSize: clamp(s.bandSize, 25, 0, 100),
        feather: clamp(s.feather, 20, 0, 100),
        angle: clamp(s.angle, 0, -180, 180),
      } as P1FilterSettingsMap[K];
    case "wave":
      return {
        amount: clamp(s.amount, 10, -999, 999),
        wavelength: clamp(s.wavelength, 64, 2, 999),
        phase: clamp(s.phase, 0, -180, 180),
        waveType: choice(s.waveType, ["sine", "triangle"], "sine"),
        edgeMode: choice(s.edgeMode, ["transparent", "clamp", "wrap"], "clamp"),
      } as P1FilterSettingsMap[K];
    case "ripple":
      return {
        amount: clamp(s.amount, 100, -999, 999),
        size: choice(s.size, ["small", "medium", "large"], "medium"),
        center: point(s.center),
      } as P1FilterSettingsMap[K];
    case "twirl":
      return {
        angle: clamp(s.angle, 50, -999, 999),
        radius: clamp(s.radius, 50, 1, 100),
        center: point(s.center),
      } as P1FilterSettingsMap[K];
    case "spherize":
      return {
        amount: clamp(s.amount, 100, -100, 100),
        mode: choice(s.mode, ["normal", "horizontal", "vertical"], "normal"),
        center: point(s.center),
      } as P1FilterSettingsMap[K];
    case "polar-coordinates":
      return {
        mode: choice(
          s.mode,
          ["rectangular-to-polar", "polar-to-rectangular"],
          "rectangular-to-polar",
        ),
      } as P1FilterSettingsMap[K];
    case "dust-scratches":
      return {
        radius: integer(s.radius, 2, 1, 100),
        threshold: clamp(s.threshold, 10, 0, 255),
      } as P1FilterSettingsMap[K];
    case "despeckle":
      return {
        strength: clamp(s.strength, 50, 0, 100),
      } as P1FilterSettingsMap[K];
    case "mosaic":
      return {
        cellSize: integer(s.cellSize, 10, 2, 500),
      } as P1FilterSettingsMap[K];
    case "color-halftone":
      return {
        radius: clamp(s.radius, 8, 2, 127),
        angle1: clamp(s.angle1, 108, -180, 180),
        angle2: clamp(s.angle2, 162, -180, 180),
        angle3: clamp(s.angle3, 90, -180, 180),
        angle4: clamp(s.angle4, 45, -180, 180),
      } as P1FilterSettingsMap[K];
    case "clouds":
      return {
        scale: clamp(s.scale, 128, 2, 2048),
        detail: integer(s.detail, 4, 1, 8),
        seed: integer(s.seed, 1, 0, 65535),
      } as P1FilterSettingsMap[K];
    case "lens-flare":
      return {
        brightness: clamp(s.brightness, 100, 10, 300),
        lensType: choice(
          s.lensType,
          ["50-300mm", "35mm", "105mm", "movie-prime"],
          "50-300mm",
        ),
        center: point(s.center),
      } as P1FilterSettingsMap[K];
    case "find-edges":
      return { amount: clamp(s.amount, 100, 0, 100) } as P1FilterSettingsMap[K];
    case "emboss":
      return {
        angle: clamp(s.angle, 135, -180, 180),
        height: integer(s.height, 3, 1, 10),
        amount: clamp(s.amount, 100, 1, 500),
      } as P1FilterSettingsMap[K];
  }
};

export const p1FilterDefinition = <K extends P1FilterKind>(
  kind: K,
): P1FilterDefinition<K> =>
  byKind.get(kind)! as unknown as P1FilterDefinition<K>;
export const defaultP1FilterSettings = <K extends P1FilterKind>(
  kind: K,
): P1FilterSettingsMap[K] =>
  normalizeP1FilterSettings(kind, p1FilterDefinition(kind).defaults);

export const P1_FILTER_PACK: FilterPackContract<P1FilterDefinition> =
  Object.freeze({
    id: "p1",
    maturity: "preview",
    definitions: P1_FILTER_DEFINITIONS,
    normalize: (kind: string, value: unknown) => {
      if (!isP1FilterKind(kind))
        throw new Error(`Unknown P1 filter kind: ${kind}`);
      return normalizeP1FilterSettings(kind, value);
    },
  });
