// Seeded, deterministic pseudo-random number generation.
//
// A mulberry32 generator underlies everything. `Stream` wraps one generator
// instance with convenience helpers (pick, weightedPick, chance, shuffle,
// int). `makeStreams` derives several independent streams from one master
// seed by hashing stream names into new seeds — so that, e.g., the lexicon
// generator consuming more or less randomness never perturbs the phonology
// generator's output. See test/prng.test.ts for the property test that
// pins this down.

export type WeightedPair<T> = readonly [T, number];

/** 32-bit FNV-1a string hash. Used only to derive stream seeds from names. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, decent-quality 32-bit seeded PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Stream {
  #next: () => number;

  constructor(seed: number) {
    this.#next = mulberry32(seed >>> 0);
  }

  /** Uniform random float in [0, 1). */
  next(): number {
    return this.#next();
  }

  /** Uniform random integer in [lo, hi], inclusive on both ends. */
  int(lo: number, hi: number): number {
    if (hi < lo) throw new Error(`int: hi (${hi}) < lo (${lo})`);
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** True with probability p (0 <= p <= 1). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniformly pick one element of a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('pick: empty array');
    const idx = Math.floor(this.next() * arr.length);
    return arr[Math.min(idx, arr.length - 1)]!;
  }

  /** Pick one element from [item, weight] pairs, weighted by `weight`. */
  weightedPick<T>(pairs: readonly WeightedPair<T>[]): T {
    if (pairs.length === 0) throw new Error('weightedPick: empty array');
    const total = pairs.reduce((sum, [, w]) => sum + w, 0);
    if (total <= 0) throw new Error('weightedPick: total weight must be positive');
    let r = this.next() * total;
    for (const [item, w] of pairs) {
      if (r < w) return item;
      r -= w;
    }
    // Floating point fallback: return the last item.
    return pairs[pairs.length - 1]![0];
  }

  /** Non-mutating Fisher-Yates shuffle. */
  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = a[i]!;
      a[i] = a[j]!;
      a[j] = tmp;
    }
    return a;
  }
}

export type Streams = {
  phonology: Stream;
  lexicon: Stream;
  history: Stream;
  /** Independent stream per branch id, e.g. branch('north-1'). */
  branch(id: string): Stream;
  /**
   * specs/M5.md: semantic drift/taboo/coinage sampling draws from a NEW
   * stream family (`drift:<branchId>`), distinct from `branch:<id>`, so
   * turning drift on or off (or changing its rates) never perturbs a
   * single sound-change draw — the M3 goldens stay byte-identical.
   */
  drift(id: string): Stream;
  /**
   * specs/M6.md: contact/borrowing draws from yet another independent
   * stream family, one per unordered pair of branch ids
   * (`contact:<idA>|<idB>`, ids sorted lexicographically so the stream for
   * a pair doesn't depend on which side is passed first). Distinct from
   * `branch:<id>` and `drift:<id>`, so enabling/disabling contact (or any
   * other pair's borrowing activity) never perturbs a branch's own
   * sound-change or drift draws.
   */
  contact(idA: string, idB: string): Stream;
  /**
   * specs/M7.md: per-language orthography conventions are sampled from yet
   * another independent stream family, one per leaf branch id
   * (`orthography:<branchId>`), consumed only at query/render time — never
   * during `generateSimulation` itself. Distinct from every other family, so
   * sampling (or not sampling) a leaf's orthography can never perturb the
   * simulation's own content: branch shape, sound-change events,
   * drift/taboo/coinage, or borrowing are all byte-identical whether or not
   * any caller ever asks for an Orthography.
   */
  orthography(branchId: string): Stream;
};

/**
 * Derive independent named streams from one master seed. Each stream's seed
 * is `hash("<masterSeed>:<name>")`, so streams never share generator state
 * and consuming randomness from one cannot affect another.
 */
export function makeStreams(seed: number): Streams {
  const derive = (name: string): Stream => new Stream(hashString(`${seed}:${name}`));
  return {
    phonology: derive('phonology'),
    lexicon: derive('lexicon'),
    history: derive('history'),
    branch(id: string): Stream {
      return derive(`branch:${id}`);
    },
    drift(id: string): Stream {
      return derive(`drift:${id}`);
    },
    contact(idA: string, idB: string): Stream {
      const [x, y] = [idA, idB].sort();
      return derive(`contact:${x}|${y}`);
    },
    orthography(branchId: string): Stream {
      return derive(`orthography:${branchId}`);
    },
  };
}
