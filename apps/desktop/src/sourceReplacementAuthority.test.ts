import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { SourceReplacementAuthority } from './sourceReplacementAuthority';

describe('SourceReplacementAuthority', () => {
  it('allows only an opened source with a matching output format', () => {
    const authority = new SourceReplacementAuthority();
    const identity = { size: 120, modifiedAtMs: 42 };
    const source = authority.authorize(path.join('fixtures', 'portrait.JPG'), identity);
    expect(authority.resolve({ path: source, format: 'jpeg' }, identity)).toBe(source);
    expect(() => authority.resolve({ path: source, format: 'png' }, identity)).toThrow(/format/i);
    expect(() => authority.resolve(
      { path: path.join('fixtures', 'other.jpg'), format: 'jpeg' }, identity
    ))
      .toThrow(/authorized/i);
  });

  it('refuses to overwrite a source changed by another application', () => {
    const authority = new SourceReplacementAuthority();
    const source = authority.authorize(
      path.join('fixtures', 'portrait.png'),
      { size: 120, modifiedAtMs: 42 }
    );
    expect(() => authority.resolve(
      { path: source, format: 'png' },
      { size: 121, modifiedAtMs: 43 }
    )).toThrow(/changed outside/i);
  });

  it('bounds retained open-file authority', () => {
    const authority = new SourceReplacementAuthority(1);
    const identity = { size: 1, modifiedAtMs: 1 };
    const first = authority.authorize(path.join('fixtures', 'first.png'), identity);
    const second = authority.authorize(path.join('fixtures', 'second.png'), identity);
    expect(() => authority.resolve({ path: first, format: 'png' }, identity)).toThrow(/authorized/i);
    expect(authority.resolve({ path: second, format: 'png' }, identity)).toBe(second);
  });
});
