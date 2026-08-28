import type {
  P2FilterKind,
  P2FilterSettingsMap,
} from "@lighttable/filter-core";
import { AdvancedWarpCore, type AdvancedWarpMode } from "./AdvancedWarpCore";
import { CellularCore, type CellularMode } from "./CellularCore";
import {
  ProceduralTextureCore,
  type ProceduralTextureMode,
} from "./ProceduralTextureCore";
import {
  ShapeConvolutionCore,
  type ShapeConvolutionMode,
} from "./ShapeConvolutionCore";
import { StylizationCore, type StylizationMode } from "./StylizationCore";
import type {
  FilterPackExecutionRequest,
  FilterPackExecutor,
} from "./FilterPackExecutor";
import type { FilterTargetPool } from "./FilterTargetPool";

const warp = new Set<P2FilterKind>([
  "path-blur",
  "spin-blur",
  "pinch",
  "shear",
  "glass",
]);
const convolution = new Set<P2FilterKind>(["shape-blur", "custom"]);
const cellular = new Set<P2FilterKind>([
  "crystallize",
  "mezzotint",
  "pointillize",
]);
const procedural = new Set<P2FilterKind>(["difference-clouds", "fibers"]);
const stylization = new Set<P2FilterKind>([
  "smart-blur",
  "oil-paint",
  "glowing-edges",
  "diffuse",
  "solarize",
  "cutout",
  "plastic-wrap",
  "poster-edges",
  "watercolor",
  "photocopy",
  "halftone-pattern",
  "stamp",
  "torn-edges",
  "texturizer",
]);
const kinds = new Set<P2FilterKind>([
  ...warp,
  ...convolution,
  ...cellular,
  ...procedural,
  ...stylization,
]);

export class P2FilterExecutor implements FilterPackExecutor {
  readonly packId = "p2" as const;
  private readonly warp: AdvancedWarpCore;
  private readonly convolution: ShapeConvolutionCore;
  private readonly cellular: CellularCore;
  private readonly procedural: ProceduralTextureCore;
  private readonly stylization: StylizationCore;

  constructor(device: GPUDevice, pool: FilterTargetPool) {
    this.warp = new AdvancedWarpCore(device, pool);
    this.convolution = new ShapeConvolutionCore(device, pool);
    this.cellular = new CellularCore(device, pool);
    this.procedural = new ProceduralTextureCore(device, pool);
    this.stylization = new StylizationCore(device, pool);
  }

  configure(width: number, height: number, sampler: GPUSampler): void {
    this.warp.configure(width, height, sampler);
    this.convolution.configure(width, height);
    this.cellular.configure(width, height, sampler);
    this.procedural.configure(width, height);
    this.stylization.configure(width, height, sampler);
  }

  supports(kind: string): boolean {
    return kinds.has(kind as P2FilterKind);
  }

  encode(request: FilterPackExecutionRequest): GPUTexture {
    const shared = { key: request.key, revision: request.revision };
    if (warp.has(request.kind as P2FilterKind)) {
      const mode = request.kind as AdvancedWarpMode;
      return this.warp.encode(request.encoder, request.source, {
        ...shared,
        mode,
        settings: request.settings as P2FilterSettingsMap[typeof mode],
      });
    }
    if (convolution.has(request.kind as P2FilterKind)) {
      const mode = request.kind as ShapeConvolutionMode;
      return this.convolution.encode(request.encoder, request.source, {
        ...shared,
        mode,
        settings: request.settings as P2FilterSettingsMap[typeof mode],
      });
    }
    if (cellular.has(request.kind as P2FilterKind)) {
      const mode = request.kind as CellularMode;
      return this.cellular.encode(request.encoder, request.source, {
        ...shared,
        mode,
        settings: request.settings as P2FilterSettingsMap[typeof mode],
      });
    }
    if (procedural.has(request.kind as P2FilterKind)) {
      const mode = request.kind as ProceduralTextureMode;
      return this.procedural.encode(request.encoder, request.source, {
        ...shared,
        mode,
        settings: request.settings as P2FilterSettingsMap[typeof mode],
      });
    }
    if (stylization.has(request.kind as P2FilterKind)) {
      const mode = request.kind as StylizationMode;
      return this.stylization.encode(request.encoder, request.source, {
        ...shared,
        mode,
        settings: request.settings as P2FilterSettingsMap[typeof mode],
      });
    }
    return request.source;
  }

  releaseInactive(keys: ReadonlySet<string>): void {
    this.warp.releaseInactive(keys);
    this.convolution.releaseInactive(keys);
    this.cellular.releaseInactive(keys);
    this.procedural.releaseInactive(keys);
    this.stylization.releaseInactive(keys);
  }

  destroy(): void {
    this.warp.destroy();
    this.convolution.destroy();
    this.cellular.destroy();
    this.procedural.destroy();
    this.stylization.destroy();
  }
}
