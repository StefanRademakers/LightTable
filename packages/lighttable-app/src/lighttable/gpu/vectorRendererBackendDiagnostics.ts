let locked = false;
let detailedProfilingEnabled = false;

/** Build/host diagnostic only; production packages leave this disabled. */
export const configureVectorRendererDetailedProfiling = (enabled: boolean) => {
  if (locked && enabled !== detailedProfilingEnabled) {
    throw new Error('Vector renderer profiling cannot change after WebGPU initialization.');
  }
  detailedProfilingEnabled = enabled;
};

export const vectorRendererDetailedProfilingEnabled = () => detailedProfilingEnabled;

export const lockVectorRendererConfiguration = () => {
  locked = true;
};
