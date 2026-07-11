// Shared helpers for M2 tests: build Words from romanized strings (reusing
// romanize.ts's parse(), which already round-trips every segment our
// catalog can produce, nasal vowels included) so before/after comparisons
// in tests read like real etymologies.

import type { Word } from '../../src/phonology.js';
import { parse } from '../../src/romanize.js';
import { Stream } from '../../src/prng.js';
import { CATALOG } from '../../src/changes/catalog.js';
import type { SoundChange } from '../../src/changes/rules.js';

/** Parse `s`, optionally overriding the stress index (parse() always picks
 * the first vowel; tests that need non-initial stress override it here). */
export function w(s: string, stress?: number): Word {
  const word = parse(s);
  return stress === undefined ? word : { ...word, stress };
}

/** Instantiate one catalog entry by id with a fixed dummy stream (none of
 * our factories consume stream entropy for id/subRules, so this is stable
 * and deterministic across calls). */
export function getChange(id: string, seed = 1): SoundChange {
  for (const factory of CATALOG) {
    const c = factory(new Stream(seed));
    if (c.id === id) return c;
  }
  throw new Error(`no catalog entry with id "${id}"`);
}
