import { describe, expect, it } from 'vitest';
import { Stream, makeStreams } from '../src/prng.js';

describe('Stream', () => {
  it('is deterministic for a given seed', () => {
    const a = new Stream(1234);
    const b = new Stream(1234);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('next() stays within [0, 1)', () => {
    const s = new Stream(7);
    for (let i = 0; i < 1000; i++) {
      const n = s.next();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });

  it('int(lo, hi) is inclusive on both ends and stays in range', () => {
    const s = new Stream(99);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const n = s.int(4, 8);
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(8);
      seen.add(n);
    }
    expect([...seen].sort()).toEqual([4, 5, 6, 7, 8]);
  });

  it('pick() only returns array elements', () => {
    const s = new Stream(5);
    const arr = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(s.pick(arr));
    }
  });

  it('weightedPick() respects zero-weight exclusion', () => {
    const s = new Stream(5);
    for (let i = 0; i < 200; i++) {
      const picked = s.weightedPick([
        ['always', 1],
        ['never', 0],
      ]);
      expect(picked).toBe('always');
    }
  });

  it('shuffle() is non-mutating and a permutation of the input', () => {
    const s = new Stream(2);
    const arr = [1, 2, 3, 4, 5];
    const copy = [...arr];
    const shuffled = s.shuffle(arr);
    expect(arr).toEqual(copy); // not mutated
    expect([...shuffled].sort()).toEqual([...arr].sort());
  });

  it('chance(0) is always false and chance(1) is always true', () => {
    const s = new Stream(3);
    for (let i = 0; i < 50; i++) {
      expect(s.chance(0)).toBe(false);
    }
    for (let i = 0; i < 50; i++) {
      expect(s.chance(1)).toBe(true);
    }
  });
});

describe('makeStreams', () => {
  it('is deterministic for a given seed', () => {
    const a = makeStreams(42);
    const b = makeStreams(42);
    expect(a.phonology.next()).toBe(b.phonology.next());
    expect(a.lexicon.next()).toBe(b.lexicon.next());
    expect(a.history.next()).toBe(b.history.next());
    expect(a.branch('north').next()).toBe(b.branch('north').next());
  });

  it('gives named streams independent state', () => {
    const streams = makeStreams(42);
    const phonologyFirst = streams.phonology.next();
    // Consume a bunch of lexicon randomness in between.
    for (let i = 0; i < 50; i++) streams.lexicon.next();
    const phonologySecond = streams.phonology.next();

    const fresh = makeStreams(42);
    fresh.phonology.next(); // advance to the same position as phonologyFirst
    expect(fresh.phonology.next()).toBe(phonologySecond);
    expect(phonologyFirst).not.toBe(phonologySecond); // sanity: stream does advance
  });

  it('different stream names produce different sequences', () => {
    const streams = makeStreams(42);
    const p = Array.from({ length: 5 }, () => streams.phonology.next());
    const l = Array.from({ length: 5 }, () => streams.lexicon.next());
    expect(p).not.toEqual(l);
  });

  it('branch streams are independent per id', () => {
    const streams = makeStreams(1);
    const north = streams.branch('north').next();
    const south = streams.branch('south').next();
    expect(north).not.toBe(south);
  });
});
