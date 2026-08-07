export type NumericExpressionKind = 'integer' | 'float';

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i;

/**
 * Evaluates a deliberately small arithmetic language for professional numeric
 * controls. It never executes JavaScript and accepts only finite numbers,
 * parentheses and +, -, *, / operators.
 */
export const evaluateNumericExpression = (source: string): number | null => {
  const input = source.trim().replaceAll(',', '.');
  if (!input || input.length > 128) return null;
  let cursor = 0;
  const whitespace = () => { while (/\s/.test(input[cursor] ?? '')) cursor += 1; };
  const primary = (): number | null => {
    whitespace();
    const character = input[cursor];
    if (character === '+' || character === '-') {
      cursor += 1;
      const value = primary();
      return value === null ? null : character === '-' ? -value : value;
    }
    if (character === '(') {
      cursor += 1;
      const value = expression();
      whitespace();
      if (value === null || input[cursor] !== ')') return null;
      cursor += 1;
      return value;
    }
    const match = input.slice(cursor).match(NUMBER);
    if (!match) return null;
    cursor += match[0].length;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : null;
  };
  const product = (): number | null => {
    let value = primary();
    if (value === null) return null;
    while (true) {
      whitespace();
      const operator = input[cursor];
      if (operator !== '*' && operator !== '/') return value;
      cursor += 1;
      const right = primary();
      if (right === null || (operator === '/' && right === 0)) return null;
      value = operator === '*' ? value * right : value / right;
      if (!Number.isFinite(value)) return null;
    }
  };
  const expression = (): number | null => {
    let value = product();
    if (value === null) return null;
    while (true) {
      whitespace();
      const operator = input[cursor];
      if (operator !== '+' && operator !== '-') return value;
      cursor += 1;
      const right = product();
      if (right === null) return null;
      value = operator === '+' ? value + right : value - right;
      if (!Number.isFinite(value)) return null;
    }
  };
  const result = expression();
  whitespace();
  return result !== null && cursor === input.length ? result : null;
};

export const resolveNumericExpression = (
  source: string,
  kind: NumericExpressionKind
): number | null => {
  const value = evaluateNumericExpression(source);
  return value === null ? null : kind === 'integer' ? Math.round(value) : value;
};
