import { identityAffineMatrix, multiplyMatrices, rotationMatrix, scaleMatrix,
  translationMatrix, type AffineMatrix } from '@lighttable/vector-core';
import { finiteNumber, parseNumberList } from './numbers';
import { SvgCodecError } from './types';

export const parseSvgTransform = (value: string | null): AffineMatrix => {
  if (!value?.trim()) return identityAffineMatrix();
  let rest = value.trim();
  let result = identityAffineMatrix();
  while (rest.length) {
    const match = /^([a-zA-Z]+)\s*\(([^)]*)\)\s*,?\s*/u.exec(rest);
    if (!match) throw new SvgCodecError('invalid-transform', 'SVG transform syntax is invalid.');
    const name = match[1]!.toLowerCase();
    const numbers = parseNumberList(match[2]!, `transform ${name}`);
    let next: AffineMatrix;
    if (name === 'matrix' && numbers.length === 6) {
      next = { a: numbers[0]!, b: numbers[1]!, c: numbers[2]!, d: numbers[3]!,
        tx: numbers[4]!, ty: numbers[5]! };
    } else if (name === 'translate' && (numbers.length === 1 || numbers.length === 2)) {
      next = translationMatrix(numbers[0]!, numbers[1] ?? 0);
    } else if (name === 'scale' && (numbers.length === 1 || numbers.length === 2)) {
      next = scaleMatrix(numbers[0]!, numbers[1] ?? numbers[0]!);
    } else if (name === 'rotate' && (numbers.length === 1 || numbers.length === 3)) {
      const rotation = rotationMatrix(numbers[0]! * Math.PI / 180);
      next = numbers.length === 1 ? rotation : multiplyMatrices(
        translationMatrix(numbers[1]!, numbers[2]!),
        multiplyMatrices(rotation, translationMatrix(-numbers[1]!, -numbers[2]!))
      );
    } else if ((name === 'skewx' || name === 'skewy') && numbers.length === 1) {
      const tangent = Math.tan(finiteNumber(String(numbers[0]), name) * Math.PI / 180);
      next = name === 'skewx' ? { a: 1, b: 0, c: tangent, d: 1, tx: 0, ty: 0 }
        : { a: 1, b: tangent, c: 0, d: 1, tx: 0, ty: 0 };
    } else {
      throw new SvgCodecError('unsupported-transform', `Unsupported ${name} transform parameters.`);
    }
    result = multiplyMatrices(result, next);
    rest = rest.slice(match[0].length);
  }
  return result;
};

export const serializeTransform = (matrix: AffineMatrix) => (
  `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.tx} ${matrix.ty})`
);
