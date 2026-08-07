export const RELEASE_SOAK_PROFILES = Object.freeze({
  ci: Object.freeze({ durationMinutes: 0, maximumCycles: 1, stressIterations: 2 }),
  // Six repetitions provide a real stable tail after one mutating warm-up;
  // three samples are too short to distinguish React/GC oscillation from
  // monotonic retained growth on large documents.
  local: Object.freeze({ durationMinutes: 60, maximumCycles: Infinity, stressIterations: 6 }),
  overnight: Object.freeze({ durationMinutes: 12 * 60, maximumCycles: Infinity, stressIterations: 6 })
});

export const resolveReleaseSoakPlan = ({ profile = 'ci', durationMinutes, cycles, iterations } = {}) => {
  const preset = RELEASE_SOAK_PROFILES[profile];
  if (!preset) throw new Error(`Unknown soak profile '${profile}'. Use ci, local or overnight.`);
  const number = (value, fallback, minimum) => value === undefined ? fallback
    : Math.max(minimum, Number.parseInt(String(value), 10) || fallback);
  return {
    profile,
    durationMinutes: number(durationMinutes, preset.durationMinutes, 0),
    maximumCycles: cycles === undefined ? preset.maximumCycles : number(cycles, 1, 1),
    stressIterations: number(iterations, preset.stressIterations, 2)
  };
};

export const assessStableTail = (files) => {
  const reasons = [];
  for (const file of files) {
    if (!file.passed) reasons.push(`${file.sourceFile}: scenario failed`);
    if (!file.actions?.length) reasons.push(`${file.sourceFile}: zero actions`);
    if (file.pageErrors?.length) reasons.push(`${file.sourceFile}: page errors`);
    if (file.growth?.suspicious) reasons.push(`${file.sourceFile}: suspicious retained growth`);
    if (file.background?.submittedFrames !== 0) reasons.push(`${file.sourceFile}: background submissions`);
    if (file.firstUsefulFrame?.status !== 'available') reasons.push(`${file.sourceFile}: no first useful frame`);
    const last = file.samples?.at(-1);
    if (!last || last.runtimeStopped || !Number.isFinite(last.gpuBytes) || last.gpuBytes <= 0) {
      reasons.push(`${file.sourceFile}: invalid final rendered sample`);
    }
  }
  return { passed: reasons.length === 0, reasons };
};

export const assessGpuRetentionTrend = (samples, {
  maximumHighWaterGrowthBytes = 1024 * 1024,
  tailSampleCount = 4,
  maximumTailHighWaterIncreases = 1
} = {}) => {
  const values = samples
    .map((sample) => sample?.estimatedGpuBytes)
    .filter(Number.isFinite);
  if (values.length === 0) {
    return {
      available: false,
      passed: true,
      reason: 'GPU retention telemetry unavailable',
      baselineBytes: null,
      peakBytes: null,
      highWaterGrowthBytes: null,
      highWaterIncreases: 0,
      positiveRounds: 0,
      tailSampleCount,
      tailHighWaterGrowthBytes: null,
      tailHighWaterIncreases: 0,
      maximumHighWaterGrowthBytes,
      maximumTailHighWaterIncreases
    };
  }

  const baselineBytes = values[0];
  let highWaterBytes = baselineBytes;
  let highWaterIncreases = 0;
  let positiveRounds = 0;
  const highWaterSteps = [];
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const value = values[index];
    if (value > previous) positiveRounds += 1;
    if (value <= highWaterBytes) continue;
    const growthBytes = value - highWaterBytes;
    highWaterBytes = value;
    highWaterIncreases += 1;
    highWaterSteps.push({ sample: index + 1, growthBytes, highWaterBytes });
  }

  const highWaterGrowthBytes = highWaterBytes - baselineBytes;
  const tailStartIndex = Math.max(0, values.length - tailSampleCount);
  const highWaterAtTailStart = Math.max(...values.slice(0, tailStartIndex + 1));
  const tailSteps = highWaterSteps.filter(({ sample }) => sample > tailStartIndex + 1);
  const tailHighWaterGrowthBytes = highWaterBytes - highWaterAtTailStart;
  const tailHighWaterIncreases = tailSteps.length;
  const reasons = [];
  if (highWaterGrowthBytes > maximumHighWaterGrowthBytes) {
    reasons.push(`GPU high-water growth ${highWaterGrowthBytes} exceeds ${maximumHighWaterGrowthBytes} bytes`);
  }
  if (tailHighWaterIncreases > maximumTailHighWaterIncreases) {
    reasons.push(`GPU high-water increased ${tailHighWaterIncreases} times in the stable tail (maximum ${maximumTailHighWaterIncreases})`);
  }
  return {
    available: true,
    passed: reasons.length === 0,
    reason: reasons.join('; ') || (highWaterIncreases === 0
      ? 'GPU high-water remained flat'
      : 'bounded lazy GPU realization'),
    baselineBytes,
    peakBytes: highWaterBytes,
    highWaterGrowthBytes,
    highWaterIncreases,
    positiveRounds,
    highWaterSteps,
    tailSampleCount,
    tailHighWaterGrowthBytes,
    tailHighWaterIncreases,
    maximumHighWaterGrowthBytes,
    maximumTailHighWaterIncreases
  };
};

export const provisionalWindowsTargets = Object.freeze({
  discrete: Object.freeze({ directManipulationMs: 16.7, ordinaryFirstUsefulFrameMs: 1000 }),
  integrated: Object.freeze({ directManipulationMs: 33.3, ordinaryFirstUsefulFrameMs: 2000 }),
  note: 'Provisional engineering targets only; a hardware class is supported only after a physical-device run.'
});
