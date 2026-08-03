import type { RendererBakeoffDecision, RendererBakeoffMeasurement } from './contracts';

export const compareR8Images = (reference: Uint8Array, actual: Uint8Array) => {
  if (reference.byteLength !== actual.byteLength || reference.byteLength === 0) {
    throw new TypeError('Bakeoff images must have the same non-zero byte length.');
  }
  let total = 0;
  let maximum = 0;
  for (let index = 0; index < reference.length; index += 1) {
    const difference = Math.abs(reference[index] - actual[index]) / 255;
    total += difference;
    maximum = Math.max(maximum, difference);
  }
  return { meanAbsoluteError: total / reference.length, maximumAbsoluteError: maximum };
};

export const decideTextRendererBakeoff = (
  measurements: readonly RendererBakeoffMeasurement[]
): RendererBakeoffDecision => {
  const coverage = measurements.filter((entry) => entry.candidate === 'coverage-atlas');
  const hbGpu = measurements.filter((entry) => entry.candidate === 'hb-gpu');
  const coverageValid = coverage.length > 0 && coverage.every((entry) => entry.shaderValidated && !entry.error);
  const hbGpuValid = hbGpu.length > 0 && hbGpu.every((entry) => entry.shaderValidated && !entry.error);
  const hbGpuMeasured = hbGpuValid && hbGpu.every((entry) => entry.meanAbsoluteError <= 0.02);
  const reasons: string[] = [];
  reasons.push(coverageValid
    ? 'Coverage atlas passed the bounded shader and fixture gates.'
    : 'Coverage atlas did not complete every bounded shader and fixture gate.');
  reasons.push(hbGpuMeasured
    ? 'hb-gpu met the provisional quality threshold on every measured scenario.'
    : 'hb-gpu remains conditional until encoded real-glyph quality and cross-device coverage are complete.');
  return {
    coverageAtlas: coverageValid ? 'GO' : 'NO-GO',
    hbGpu: hbGpuMeasured ? 'GO' : hbGpuValid ? 'CONDITIONAL GO' : 'NO-GO',
    productionDefault: 'coverage-atlas',
    reasons
  };
};
