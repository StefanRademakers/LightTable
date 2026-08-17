export type CurveChannel = 'master' | 'red' | 'green' | 'blue';

export interface CurvePoint {
  x: number;
  y: number;
}

export type ToneCurve = CurvePoint[];

export interface CurvesAdjustments {
  interpolation?: 'monotone' | 'photoshop-natural';
  master: ToneCurve;
  red: ToneCurve;
  green: ToneCurve;
  blue: ToneCurve;
}

export const CURVE_CHANNELS: CurveChannel[] = ['master', 'red', 'green', 'blue'];
export const CURVE_LUT_SIZE = 1024;

export const createIdentityCurve = (): ToneCurve => [{ x: 0, y: 0 }, { x: 1, y: 1 }];

export const createDefaultCurves = (
  interpolation: NonNullable<CurvesAdjustments['interpolation']> = 'monotone'
): CurvesAdjustments => ({
  interpolation,
  master: createIdentityCurve(),
  red: createIdentityCurve(),
  green: createIdentityCurve(),
  blue: createIdentityCurve()
});

export const cloneCurves = (curves: CurvesAdjustments): CurvesAdjustments => ({
  interpolation: curves.interpolation ?? 'monotone',
  master: curves.master.map((point) => ({ ...point })),
  red: curves.red.map((point) => ({ ...point })),
  green: curves.green.map((point) => ({ ...point })),
  blue: curves.blue.map((point) => ({ ...point }))
});

export const normalizeCurvePoints = (points: ToneCurve): ToneCurve => {
  const sorted = points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({ x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) }))
    .sort((left, right) => left.x - right.x);
  const unique: ToneCurve = [];
  for (const point of sorted) {
    const previous = unique[unique.length - 1];
    if (previous && Math.abs(previous.x - point.x) < 1e-5) previous.y = point.y;
    else unique.push(point);
  }
  return unique.length >= 2 ? unique : createIdentityCurve();
};

const pchipSlopes = (points: ToneCurve): number[] => {
  const count = points.length;
  const interval = Array.from({ length: count - 1 }, (_, index) => points[index + 1].x - points[index].x);
  const delta = interval.map((width, index) => (points[index + 1].y - points[index].y) / width);
  if (count === 2) return [delta[0], delta[0]];
  const slopes = new Array<number>(count).fill(0);
  for (let index = 1; index < count - 1; index += 1) {
    if (delta[index - 1] === 0 || delta[index] === 0 || Math.sign(delta[index - 1]) !== Math.sign(delta[index])) {
      slopes[index] = 0;
      continue;
    }
    const firstWeight = 2 * interval[index] + interval[index - 1];
    const secondWeight = interval[index] + 2 * interval[index - 1];
    slopes[index] = (firstWeight + secondWeight) /
      (firstWeight / delta[index - 1] + secondWeight / delta[index]);
  }
  const endpoint = (h0: number, h1: number, d0: number, d1: number) => {
    let slope = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(slope) !== Math.sign(d0)) slope = 0;
    else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(slope) > Math.abs(3 * d0)) slope = 3 * d0;
    return slope;
  };
  slopes[0] = endpoint(interval[0], interval[1], delta[0], delta[1]);
  slopes[count - 1] = endpoint(
    interval[count - 2], interval[count - 3], delta[count - 2], delta[count - 3]
  );
  return slopes;
};

export const evaluateToneCurve = (sourcePoints: ToneCurve, x: number): number => {
  const points = normalizeCurvePoints(sourcePoints);
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;
  const slopes = pchipSlopes(points);
  let index = 0;
  while (index < points.length - 2 && x > points[index + 1].x) index += 1;
  const left = points[index];
  const right = points[index + 1];
  const width = right.x - left.x;
  const t = (x - left.x) / width;
  const t2 = t * t;
  const t3 = t2 * t;
  const value =
    (2 * t3 - 3 * t2 + 1) * left.y +
    (t3 - 2 * t2 + t) * width * slopes[index] +
    (-2 * t3 + 3 * t2) * right.y +
    (t3 - t2) * width * slopes[index + 1];
  return Math.max(0, Math.min(1, value));
};

const naturalSplineSecondDerivatives = (points: ToneCurve): number[] => {
  const second = new Array<number>(points.length).fill(0);
  const work = new Array<number>(points.length).fill(0);
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const span = next.x - previous.x;
    const sigma = (current.x - previous.x) / span;
    const pivot = sigma * second[index - 1]! + 2;
    second[index] = (sigma - 1) / pivot;
    const slopeDelta = (next.y - current.y) / (next.x - current.x)
      - (current.y - previous.y) / (current.x - previous.x);
    work[index] = (6 * slopeDelta / span - sigma * work[index - 1]!) / pivot;
  }
  for (let index = points.length - 2; index >= 0; index -= 1) {
    second[index] = second[index]! * second[index + 1]! + work[index]!;
  }
  return second;
};

const evaluateNaturalSpline = (
  points: ToneCurve,
  second: readonly number[],
  x: number
) => {
  if (x <= points[0]!.x) return points[0]!.y;
  if (x >= points[points.length - 1]!.x) return points[points.length - 1]!.y;
  let leftIndex = 0;
  while (leftIndex < points.length - 2 && x > points[leftIndex + 1]!.x) leftIndex += 1;
  const rightIndex = leftIndex + 1;
  const left = points[leftIndex]!;
  const right = points[rightIndex]!;
  const width = right.x - left.x;
  const leftWeight = (right.x - x) / width;
  const rightWeight = (x - left.x) / width;
  const value = leftWeight * left.y + rightWeight * right.y + (
    (leftWeight ** 3 - leftWeight) * second[leftIndex]!
    + (rightWeight ** 3 - rightWeight) * second[rightIndex]!
  ) * width * width / 6;
  return Math.max(0, Math.min(1, value));
};

/** Photoshop 27.11 point-curve interpolation, measured against its rendered output. */
export const evaluatePhotoshopToneCurve = (sourcePoints: ToneCurve, x: number): number => {
  const points = normalizeCurvePoints(sourcePoints);
  return evaluateNaturalSpline(points, naturalSplineSecondDerivatives(points), x);
};

export const buildCurveLut = (curves: CurvesAdjustments, size = CURVE_LUT_SIZE): Float32Array<ArrayBuffer> => {
  const output = new Float32Array(size * 4);
  const evaluators = CURVE_CHANNELS.map((channel) => {
    if (curves.interpolation !== 'photoshop-natural') {
      return (x: number) => evaluateToneCurve(curves[channel], x);
    }
    const points = normalizeCurvePoints(curves[channel]);
    const second = naturalSplineSecondDerivatives(points);
    return (x: number) => evaluateNaturalSpline(points, second, x);
  });
  for (let index = 0; index < size; index += 1) {
    const x = index / (size - 1);
    CURVE_CHANNELS.forEach((channel, channelIndex) => {
      output[index * 4 + channelIndex] = evaluators[channelIndex]!(x);
    });
  }
  return output;
};

export const curvesAreIdentity = (curves: CurvesAdjustments): boolean => CURVE_CHANNELS.every((channel) => {
  const points = normalizeCurvePoints(curves[channel]);
  return points.length === 2 && points[0].x === 0 && points[0].y === 0 && points[1].x === 1 && points[1].y === 1;
});

export const curveActiveMask = (curves: CurvesAdjustments): number => CURVE_CHANNELS.reduce((mask, channel, index) => {
  const points = normalizeCurvePoints(curves[channel]);
  const identity = points.length === 2 && points[0].x === 0 && points[0].y === 0 && points[1].x === 1 && points[1].y === 1;
  return identity ? mask : mask | (1 << index);
}, 0);
