export const RELEASE_SOAK_PROFILES = Object.freeze({
  ci: Object.freeze({ durationMinutes: 0, maximumCycles: 1, stressIterations: 2 }),
  local: Object.freeze({ durationMinutes: 60, maximumCycles: Infinity, stressIterations: 3 }),
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

export const provisionalWindowsTargets = Object.freeze({
  discrete: Object.freeze({ directManipulationMs: 16.7, ordinaryFirstUsefulFrameMs: 1000 }),
  integrated: Object.freeze({ directManipulationMs: 33.3, ordinaryFirstUsefulFrameMs: 2000 }),
  note: 'Provisional engineering targets only; a hardware class is supported only after a physical-device run.'
});
