import type {
  P1FilterKind,
  P1FilterSettingsMap,
} from "@lighttable/filter-core";
import { AnalyticWarpCore, type AnalyticWarpMode } from "./AnalyticWarpCore";
import {
  EdgeDerivativeCore,
  type EdgeDerivativeMode,
} from "./EdgeDerivativeCore";
import {
  ImpulseCleanupCore,
  type ImpulseCleanupMode,
} from "./ImpulseCleanupCore";
import {
  PixelProceduralCore,
  type PixelProceduralMode,
} from "./PixelProceduralCore";
import { VariableBlurCore, type VariableBlurMode } from "./VariableBlurCore";
import type {
  FilterPackExecutionRequest,
  FilterPackExecutor,
} from "./FilterPackExecutor";
import type { FilterTargetPool } from "./FilterTargetPool";

const variable = new Set<P1FilterKind>([
  "box-blur",
  "radial-blur",
  "field-blur",
  "iris-blur",
  "tilt-shift",
]);
const warp = new Set<P1FilterKind>([
  "wave",
  "ripple",
  "twirl",
  "spherize",
  "polar-coordinates",
]);
const cleanup = new Set<P1FilterKind>(["dust-scratches", "despeckle"]);
const pixel = new Set<P1FilterKind>([
  "mosaic",
  "color-halftone",
  "clouds",
  "lens-flare",
]);
const edge = new Set<P1FilterKind>(["find-edges", "emboss"]);
const kinds = new Set<P1FilterKind>([
  ...variable,
  ...warp,
  ...cleanup,
  ...pixel,
  ...edge,
]);

const isIdentity = (
  kind: P1FilterKind,
  settings: P1FilterSettingsMap[P1FilterKind],
): boolean => {
  const value = settings as unknown as Record<string, unknown>;
  if (["box-blur", "field-blur", "iris-blur", "tilt-shift"].includes(kind)) {
    return Number(value.radius) <= 0;
  }
  if (kind === "radial-blur") return Number(value.amount) <= 0;
  if (kind === "wave") return Number(value.amount) === 0;
  if (kind === "ripple") return Number(value.amount) === 0;
  if (kind === "twirl") return Number(value.angle) === 0;
  if (kind === "spherize") return Number(value.amount) === 0;
  if (kind === "despeckle") return Number(value.strength) <= 0;
  return false;
};

export class P1FilterExecutor implements FilterPackExecutor {
  readonly packId = "p1" as const;
  private readonly variable: VariableBlurCore;
  private readonly warp: AnalyticWarpCore;
  private readonly cleanup: ImpulseCleanupCore;
  private readonly pixel: PixelProceduralCore;
  private readonly edge: EdgeDerivativeCore;
  constructor(device: GPUDevice, pool: FilterTargetPool) {
    this.variable = new VariableBlurCore(device, pool);
    this.warp = new AnalyticWarpCore(device, pool);
    this.cleanup = new ImpulseCleanupCore(device, pool);
    this.pixel = new PixelProceduralCore(device, pool);
    this.edge = new EdgeDerivativeCore(device, pool);
  }

  configure(width: number, height: number, sampler: GPUSampler): void {
    this.variable.configure(width, height, sampler);
    this.warp.configure(width, height, sampler);
    this.cleanup.configure(width, height);
    this.pixel.configure(width, height, sampler);
    this.edge.configure(width, height);
  }

  supports(kind: string): boolean {
    return kinds.has(kind as P1FilterKind);
  }

  encode(request: FilterPackExecutionRequest): GPUTexture {
    if (
      isIdentity(
        request.kind as P1FilterKind,
        request.settings as P1FilterSettingsMap[P1FilterKind],
      )
    )
      return request.source;
    const shared = { key: request.key, revision: request.revision };
    if (variable.has(request.kind as P1FilterKind)) {
      const mode = request.kind as VariableBlurMode;
      return this.variable.encode(request.encoder, request.source, {
        ...shared,
        mode,
        settings: request.settings as P1FilterSettingsMap[typeof mode],
      });
    }
    if (warp.has(request.kind as P1FilterKind)) {
      const mode = request.kind as AnalyticWarpMode;
      return this.warp.encode(request.encoder, request.source, {
        ...shared,
        mode,
        settings: request.settings as P1FilterSettingsMap[typeof mode],
      });
    }
    if (cleanup.has(request.kind as P1FilterKind)) {
      const mode = request.kind as ImpulseCleanupMode;
      return this.cleanup.encode(request.encoder, request.source, {
        ...shared,
        mode,
        settings: request.settings as P1FilterSettingsMap[typeof mode],
      });
    }
    if (pixel.has(request.kind as P1FilterKind)) {
      const mode = request.kind as PixelProceduralMode;
      return this.pixel.encode(request.encoder, request.source, {
        ...shared,
        mode,
        settings: request.settings as P1FilterSettingsMap[typeof mode],
      });
    }
    if (edge.has(request.kind as P1FilterKind)) {
      const mode = request.kind as EdgeDerivativeMode;
      return this.edge.encode(request.encoder, request.source, {
        ...shared,
        mode,
        settings: request.settings as P1FilterSettingsMap[typeof mode],
      });
    }
    return request.source;
  }

  releaseInactive(keys: ReadonlySet<string>): void {
    this.variable.releaseInactive(keys);
    this.warp.releaseInactive(keys);
    this.cleanup.releaseInactive(keys);
    this.pixel.releaseInactive(keys);
    this.edge.releaseInactive(keys);
  }

  destroy(): void {
    this.variable.destroy();
    this.warp.destroy();
    this.cleanup.destroy();
    this.pixel.destroy();
    this.edge.destroy();
  }
}
