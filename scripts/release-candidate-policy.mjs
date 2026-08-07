export const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function assessMultiHourSoakEvidence(report, candidateCommit, minimumDurationMs = TWO_HOURS_MS) {
  const reasons = [];
  if (!report || typeof report !== 'object') {
    reasons.push('Multi-hour soak evidence is missing or unreadable.');
  } else {
    if (report.passed !== true) reasons.push('Multi-hour soak did not pass.');
    if (report.validity?.commit !== candidateCommit) {
      reasons.push('Multi-hour soak was not run against the exact candidate commit.');
    }
    if (report.validity?.worktreeDirty !== false) {
      reasons.push('Multi-hour soak did not use a verified clean worktree.');
    }
    if (!Number.isFinite(report.elapsedMs) || report.elapsedMs < minimumDurationMs) {
      reasons.push(`Multi-hour soak ran for less than ${minimumDurationMs} ms.`);
    }
    if (!Array.isArray(report.cycles) || report.cycles.length === 0
      || report.cycles.some((cycle) => cycle?.passed !== true)) {
      reasons.push('Multi-hour soak contains a missing or failed cycle.');
    }
    if (!Array.isArray(report.orphanProcesses) || report.orphanProcesses.length !== 0) {
      reasons.push('Multi-hour soak did not prove zero orphan processes.');
    }
  }
  return {
    accepted: reasons.length === 0,
    reasons,
    summary: report && typeof report === 'object' ? {
      commit: report.validity?.commit ?? null,
      cleanWorktree: report.validity?.worktreeDirty === false,
      elapsedMs: Number.isFinite(report.elapsedMs) ? report.elapsedMs : null,
      cycles: Array.isArray(report.cycles) ? report.cycles.length : 0,
      failedCycles: Array.isArray(report.cycles)
        ? report.cycles.filter((cycle) => cycle?.passed !== true).length : null,
      orphanProcesses: Array.isArray(report.orphanProcesses) ? report.orphanProcesses.length : null
    } : null
  };
}
