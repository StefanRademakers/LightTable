export interface FilterPackExecutionRequest {
  readonly encoder: GPUCommandEncoder;
  readonly source: GPUTexture;
  readonly key: string;
  readonly revision: number;
  readonly kind: string;
  readonly settings: unknown;
}

export interface FilterPackExecutor {
  readonly packId: "p1" | "p2";
  configure(width: number, height: number, sampler: GPUSampler): void;
  supports(kind: string): boolean;
  encode(request: FilterPackExecutionRequest): GPUTexture;
  releaseInactive(activeKeys: ReadonlySet<string>): void;
  destroy(): void;
}
