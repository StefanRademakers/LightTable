interface DisposableSelectionStageResource {
  destroy(): void;
}

/** Owns terminal cleanup for every GPU resource retained by one pooled selection stage. */
export const createSelectionProjectionStageDisposer = (
  rasterizer: DisposableSelectionStageResource,
  textures: DisposableSelectionStageResource,
) => {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    try {
      rasterizer.destroy();
    } finally {
      textures.destroy();
    }
  };
};
