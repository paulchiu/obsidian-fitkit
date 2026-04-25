import { describe, expect, it } from 'vitest';

import { fnv1a32 } from '../src/hash';

describe('fnv1a32', () => {
  it('hashes the empty string to the offset basis', () => {
    expect(fnv1a32('')).toBe('811c9dc5');
  });

  it('produces different hashes for different inputs', () => {
    expect(fnv1a32('a')).not.toBe(fnv1a32('b'));
  });

  it('returns an 8-character lowercase hex string', () => {
    expect(fnv1a32('hello world')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is stable for the same input', () => {
    expect(fnv1a32('x')).toBe(fnv1a32('x'));
  });
});
