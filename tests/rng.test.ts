import { describe, expect, it } from 'vitest';
import { hashString, normalizeCode, randInt, randomCode, rngFrom, shuffle } from '../src/rng';

describe('rng', () => {
  it('gives the same numbers for the same label', () => {
    const a = rngFrom('ABC123');
    const b = rngFrom('ABC123');
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('gives different numbers for different labels', () => {
    expect(rngFrom('ABC123|1|act')()).not.toBe(rngFrom('ABC123|1|monsters')());
  });

  it('keeps numbers in [0, 1) and integers in range', () => {
    const r = rngFrom('range');
    for (let i = 0; i < 1000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const n = randInt(r, 7);
      expect(Number.isInteger(n) && n >= 0 && n < 7).toBe(true);
    }
  });

  it('keeps the hash stable, so old dungeon codes keep their dungeons', () => {
    expect(hashString('')).toBe(2166136261);
    expect(hashString('a')).toBe(0xe40c292c);
  });

  it('shuffles to a permutation', () => {
    const s = shuffle(rngFrom('shuffle'), [1, 2, 3, 4, 5, 6]);
    expect([...s].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('makes readable codes and cleans typed ones', () => {
    expect(randomCode(rngFrom('code'))).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(normalizeCode(' ab-c 12 ')).toBe('ABC12');
  });
});
