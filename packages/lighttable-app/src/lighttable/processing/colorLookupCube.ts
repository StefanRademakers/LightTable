export const MAX_CUBE_LUT_SIZE = 65;

export interface ParsedCubeLut {
  readonly title: string | null;
  readonly size: number;
  readonly domainMin: readonly [number, number, number];
  readonly domainMax: readonly [number, number, number];
  /** RGB values in .cube order: red changes fastest, then green, then blue. */
  readonly values: Float32Array;
}

const finite = (value: string, label: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`The .cube ${label} is not a finite number.`);
  return parsed;
};

const triplet = (
  tokens: readonly string[],
  label: string
): readonly [number, number, number] => {
  if (tokens.length !== 4) throw new Error(`The .cube ${label} requires three values.`);
  return [finite(tokens[1]!, label), finite(tokens[2]!, label), finite(tokens[3]!, label)];
};

/** Parses the portable 3D subset of Adobe/Iridas .cube files. */
export const parseCubeLut = (source: string): ParsedCubeLut => {
  let title: string | null = null;
  let size: number | null = null;
  let domainMin: readonly [number, number, number] = [0, 0, 0];
  let domainMax: readonly [number, number, number] = [1, 1, 1];
  const values: number[] = [];

  for (const rawLine of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.replace(/\s*#.*$/, '').trim();
    if (!line) continue;
    const tokens = line.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
    const directive = tokens[0]?.toUpperCase();
    if (directive === 'TITLE') {
      title = line.slice(5).trim().replace(/^"|"$/g, '') || null;
      continue;
    }
    if (directive === 'LUT_1D_SIZE') {
      throw new Error('This Color Lookup control accepts 3D .cube LUTs, not 1D LUTs.');
    }
    if (directive === 'LUT_3D_SIZE') {
      if (tokens.length !== 2) throw new Error('The .cube LUT_3D_SIZE is invalid.');
      size = finite(tokens[1]!, 'LUT_3D_SIZE');
      if (!Number.isInteger(size) || size < 2 || size > MAX_CUBE_LUT_SIZE) {
        throw new Error(`The .cube size must be an integer from 2 through ${MAX_CUBE_LUT_SIZE}.`);
      }
      continue;
    }
    if (directive === 'DOMAIN_MIN') {
      domainMin = triplet(tokens, 'DOMAIN_MIN');
      continue;
    }
    if (directive === 'DOMAIN_MAX') {
      domainMax = triplet(tokens, 'DOMAIN_MAX');
      continue;
    }
    if (directive === 'LUT_3D_INPUT_RANGE') {
      if (tokens.length !== 3) throw new Error('The .cube LUT_3D_INPUT_RANGE is invalid.');
      const minimum = finite(tokens[1]!, 'input minimum');
      const maximum = finite(tokens[2]!, 'input maximum');
      domainMin = [minimum, minimum, minimum];
      domainMax = [maximum, maximum, maximum];
      continue;
    }
    if (tokens.length !== 3) {
      throw new Error(`Unsupported .cube directive: ${tokens[0] ?? line}`);
    }
    if (size === null) throw new Error('The .cube data appears before LUT_3D_SIZE.');
    values.push(
      finite(tokens[0]!, 'red output'),
      finite(tokens[1]!, 'green output'),
      finite(tokens[2]!, 'blue output')
    );
  }

  if (size === null) throw new Error('The file does not contain LUT_3D_SIZE.');
  domainMin.forEach((minimum, index) => {
    if (!(domainMax[index]! > minimum)) {
      throw new Error('Every .cube DOMAIN_MAX component must exceed DOMAIN_MIN.');
    }
  });
  const expected = size ** 3 * 3;
  if (values.length !== expected) {
    throw new Error(`The .cube contains ${values.length / 3} colors; ${size ** 3} are required.`);
  }
  return { title, size, domainMin, domainMax, values: new Float32Array(values) };
};

export const cubeRgbaValues = (lut: ParsedCubeLut): Float32Array<ArrayBuffer> => {
  const rgba = new Float32Array(new ArrayBuffer(lut.size ** 3 * 4 * Float32Array.BYTES_PER_ELEMENT));
  for (let source = 0, target = 0; source < lut.values.length; source += 3, target += 4) {
    rgba[target] = lut.values[source]!;
    rgba[target + 1] = lut.values[source + 1]!;
    rgba[target + 2] = lut.values[source + 2]!;
    rgba[target + 3] = 1;
  }
  return rgba;
};
