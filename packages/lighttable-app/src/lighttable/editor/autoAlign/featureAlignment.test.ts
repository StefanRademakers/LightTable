import { describe, expect, it } from 'vitest';
import {
  estimateFeatureAlignment,
  estimateFeatureAlignmentFromMatches,
  type AlignmentFeature,
  type AlignmentFeatureMatch,
  type AlignmentRaster
} from './featureAlignment';

const raster = (width = 512, height = 320): AlignmentRaster => ({
  width,
  height,
  luma: new Float32Array(width * height),
  valid: new Uint8Array(width * height).fill(1)
});

const texturedRaster = (width = 320, height = 224, seed = 0x51f15e): AlignmentRaster => {
  const luma = new Float32Array(width * height);
  const valid = new Uint8Array(width * height).fill(1);
  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const checkerSizeX = 17 + seed % 11;
      const checkerSizeY = 15 + (seed >>> 4) % 9;
      const checker = ((Math.floor(x / checkerSizeX) + Math.floor(y / checkerSizeY)) & 1) * 0.18;
      const bands = Math.sin(x * (0.05 + seed % 13 * 0.002)) * 0.08
        + Math.cos(y * (0.071 + seed % 17 * 0.001)) * 0.07;
      luma[y * width + x] = 0.2 + checker + bands + random() * 0.025;
    }
  }
  for (let index = 0; index < 18; index += 1) {
    const left = 13 + index * 47 % (width - 45);
    const top = 11 + index * 31 % (height - 39);
    const boxWidth = 9 + index * 7 % 28;
    const boxHeight = 8 + index * 11 % 24;
    const value = 0.22 + (index % 5) * 0.15;
    for (let y = top; y < Math.min(height, top + boxHeight); y += 1) {
      for (let x = left; x < Math.min(width, left + boxWidth); x += 1) {
        luma[y * width + x] = value;
      }
    }
  }
  return { width, height, luma, valid };
};

const locallyEditRaster = (source: AlignmentRaster): AlignmentRaster => {
  const luma = source.luma.slice();
  const valid = source.valid.slice();
  const left = Math.floor(source.width * 0.53);
  const top = Math.floor(source.height * 0.18);
  const right = Math.floor(source.width * 0.92);
  const bottom = Math.floor(source.height * 0.76);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const index = y * source.width + x;
      luma[index] = Math.min(1, Math.max(0, luma[index] * 0.82 + 0.11));
      if (x >= left && x < right && y >= top && y < bottom) {
        luma[index] = 0.08 + ((x * 19 + y * 37) % 71) / 90;
      }
    }
  }
  return { width: source.width, height: source.height, luma, valid };
};

const translateRaster = (
  source: AlignmentRaster,
  tx: number,
  ty: number
): AlignmentRaster => {
  const luma = new Float32Array(source.width * source.height);
  const valid = new Uint8Array(source.width * source.height);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sourceX = x - tx;
      const sourceY = y - ty;
      if (
        sourceX >= 0 && sourceX < source.width
        && sourceY >= 0 && sourceY < source.height
      ) {
        const destinationIndex = y * source.width + x;
        const sourceIndex = sourceY * source.width + sourceX;
        luma[destinationIndex] = source.luma[sourceIndex];
        valid[destinationIndex] = source.valid[sourceIndex];
      }
    }
  }
  return { width: source.width, height: source.height, luma, valid };
};

const warpRaster = (
  source: AlignmentRaster,
  transform: { a: number; b: number; tx: number; ty: number }
): AlignmentRaster => {
  const luma = new Float32Array(source.width * source.height);
  const valid = new Uint8Array(source.width * source.height);
  const determinant = transform.a * transform.a + transform.b * transform.b;
  const inverseA = transform.a / determinant;
  const inverseB = -transform.b / determinant;
  const inverseTx = -inverseA * transform.tx + inverseB * transform.ty;
  const inverseTy = -inverseB * transform.tx - inverseA * transform.ty;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sourceX = inverseA * x - inverseB * y + inverseTx;
      const sourceY = inverseB * x + inverseA * y + inverseTy;
      if (
        sourceX >= 0 && sourceX < source.width - 1
        && sourceY >= 0 && sourceY < source.height - 1
      ) {
        const x0 = Math.floor(sourceX);
        const y0 = Math.floor(sourceY);
        const fx = sourceX - x0;
        const fy = sourceY - y0;
        const top = source.luma[y0 * source.width + x0] * (1 - fx)
          + source.luma[y0 * source.width + x0 + 1] * fx;
        const bottom = source.luma[(y0 + 1) * source.width + x0] * (1 - fx)
          + source.luma[(y0 + 1) * source.width + x0 + 1] * fx;
        const destination = y * source.width + x;
        luma[destination] = top * (1 - fy) + bottom * fy;
        valid[destination] = 1;
      }
    }
  }
  return { width: source.width, height: source.height, luma, valid };
};

const feature = (x: number, y: number): AlignmentFeature => ({
  x,
  y,
  response: 1,
  level: 0,
  angle: 0,
  descriptor: new Uint32Array(8)
});

const transformedMatches = (
  scale: number,
  rotation: number,
  tx: number,
  ty: number,
  outliers = 0
) => {
  const cosine = Math.cos(rotation) * scale;
  const sine = Math.sin(rotation) * scale;
  const matches: AlignmentFeatureMatch[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      const x = 35 + column * 68;
      const y = 28 + row * 62;
      matches.push({
        reference: feature(x, y),
        target: feature(
          cosine * x - sine * y + tx,
          sine * x + cosine * y + ty
        ),
        distance: 18 + (row + column) % 7,
        secondDistance: 80
      });
    }
  }
  for (let index = 0; index < outliers; index += 1) {
    matches.push({
      reference: feature(20 + index * 13 % 450, 15 + index * 29 % 285),
      target: feature(470 - index * 31 % 440, 290 - index * 17 % 270),
      distance: 50,
      secondDistance: 90
    });
  }
  return matches;
};

describe('Auto Align V2 robust geometry', () => {
  it('detects, describes, matches and recovers a translated raster', () => {
    const reference = texturedRaster();
    const target = translateRaster(reference, 17, -12);
    const result = estimateFeatureAlignment(reference, target);

    expect(result.evidence.detectedReferenceFeatures).toBeGreaterThan(100);
    expect(result.evidence.mutualMatches).toBeGreaterThan(20);
    expect(result.evidence.inlierCount).toBeGreaterThan(15);
    expect(result.evidence.model).toBe('translation');
    expect(result.transform.tx).toBeCloseTo(17, 0);
    expect(result.transform.ty).toBeCloseTo(-12, 0);
  });

  it('detects and recovers a modest scale and rotation', () => {
    const reference = texturedRaster(360, 260);
    const scale = 1.055;
    const rotation = 3.2 * Math.PI / 180;
    const a = Math.cos(rotation) * scale;
    const b = Math.sin(rotation) * scale;
    const centerX = reference.width * 0.5;
    const centerY = reference.height * 0.5;
    const tx = centerX + 9 - a * centerX + b * centerY;
    const ty = centerY - 7 - b * centerX - a * centerY;
    const target = warpRaster(reference, { a, b, tx, ty });
    const result = estimateFeatureAlignment(reference, target);

    expect(result.evidence.mutualMatches).toBeGreaterThan(15);
    expect(result.evidence.inlierCount).toBeGreaterThan(10);
    expect(result.evidence.model).toBe('similarity');
    expect(result.evidence.estimatedScale).toBeCloseTo(scale, 1);
    expect(result.evidence.estimatedRotationDegrees).toBeCloseTo(3.2, 0);
    expect(result.transform.tx).toBeCloseTo(tx, 0);
    expect(result.transform.ty).toBeCloseTo(ty, 0);
  });

  it('keeps the transform when exposure changes and a large local region is replaced', () => {
    const reference = texturedRaster(360, 260);
    const changed = locallyEditRaster(reference);
    const target = translateRaster(changed, -14, 19);
    const result = estimateFeatureAlignment(reference, target);

    expect(result.evidence.inlierCount).toBeGreaterThan(10);
    expect(result.transform.tx).toBeCloseTo(-14, 0);
    expect(result.transform.ty).toBeCloseTo(19, 0);
  });

  it('rejects unrelated textured rasters', () => {
    const reference = texturedRaster(320, 224, 0x13579b);
    const unrelated = texturedRaster(320, 224, 0x2468ac);
    expect(() => estimateFeatureAlignment(reference, unrelated)).toThrow(/Auto Align/);
  });

  it('recovers translation without inventing rotation or scale', () => {
    const image = raster();
    const result = estimateFeatureAlignmentFromMatches(
      transformedMatches(1, 0, 23.5, -14.25, 8),
      image,
      image,
      { reference: 400, target: 390 }
    );

    expect(result.evidence.model).toBe('translation');
    expect(result.transform.a).toBeCloseTo(1, 6);
    expect(result.transform.b).toBeCloseTo(0, 6);
    expect(result.transform.tx).toBeCloseTo(23.5, 4);
    expect(result.transform.ty).toBeCloseTo(-14.25, 4);
    expect(result.evidence.inlierCount).toBe(35);
  });

  it('recovers uniform scale, rotation and translation despite outliers', () => {
    const image = raster();
    const rotation = 4.5 * Math.PI / 180;
    const result = estimateFeatureAlignmentFromMatches(
      transformedMatches(1.08, rotation, -18, 11, 14),
      image,
      image,
      { reference: 500, target: 510 }
    );

    expect(result.evidence.model).toBe('similarity');
    expect(result.evidence.estimatedScale).toBeCloseTo(1.08, 4);
    expect(result.evidence.estimatedRotationDegrees).toBeCloseTo(4.5, 3);
    expect(result.transform.tx).toBeCloseTo(-18, 3);
    expect(result.transform.ty).toBeCloseTo(11, 3);
    expect(result.evidence.inlierCount).toBe(35);
    expect(result.evidence.inlierRatio).toBeGreaterThan(0.7);
  });

  it('rejects insufficient correspondence evidence', () => {
    const image = raster();
    expect(() => estimateFeatureAlignmentFromMatches(
      transformedMatches(1, 0, 4, 5).slice(0, 5),
      image,
      image
    )).toThrow(/at least 8/);
  });
});
