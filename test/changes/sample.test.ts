// Acceptance criterion 5 (specs/M2.md): dry-run rejection. Construct a small
// lexicon where raising-e would merge a chunk of the vocabulary and assert
// it's vetoed (and, through sampleChange, resampled or turned into a quiet
// century — never returned as-is).

import { describe, expect, it } from 'vitest';
import { dryRunRejects, sampleChange } from '../../src/changes/sample.js';
import { Stream } from '../../src/prng.js';
import type { Lexeme, Lexicon } from '../../src/lexicon.js';
import type { LangState } from '../../src/changes/rules.js';
import { getChange, w } from './helpers.js';

function lexiconFrom(words: Record<string, string>): Lexicon {
  const lexemes = new Map<string, Lexeme>();
  for (const [concept, form] of Object.entries(words)) {
    lexemes.set(concept, { concept, word: w(form), origin: 'root' });
  }
  return { lexemes, affixes: [] };
}

// 10 words: "te"/"ti" and "pe"/"pi" are near-minimal pairs that raising-e
// (e > i) would merge; the other 6 are unrelated filler so the lexicon
// isn't trivially tiny. 2 new homophone pairs / 10 words = 20% increase,
// well over the 6% rejection threshold.
const MERGE_PRONE_WORDS = { te: 'te', ti: 'ti', pe: 'pe', pi: 'pi', ka: 'ka', ma: 'ma', na: 'na', sa: 'sa', la: 'la', ra: 'ra' };

describe('dry-run rejection', () => {
  it('raising-e is vetoed against a lexicon where it would merge ~20% of words', () => {
    const change = getChange('raising-e');
    const state: LangState = { lexicon: lexiconFrom(MERGE_PRONE_WORDS), changeHistory: [] };
    expect(dryRunRejects(change, state)).toBe(true);
  });

  it('raising-e is accepted against a lexicon where it causes no new collisions and keeps the inventory above the floor', () => {
    // 5 vowel qualities (e,a,o,u,i) and 8 consonants: after e > i, "te" ->
    // "ti" collides with nothing, and 4 vowel qualities / 8 consonants both
    // stay at or above the floor.
    const change = getChange('raising-e');
    const state: LangState = {
      lexicon: lexiconFrom({ te: 'te', ka: 'ka', ma: 'ma', na: 'na', po: 'po', su: 'su', li: 'li', ra: 'ra' }),
      changeHistory: [],
    };
    expect(dryRunRejects(change, state)).toBe(false);
  });

  it('sampleChange never returns a change that fails its own dry run', () => {
    const state: LangState = { lexicon: lexiconFrom(MERGE_PRONE_WORDS), changeHistory: [] };
    for (let seed = 1; seed <= 40; seed++) {
      const picked = sampleChange(state, new Stream(seed));
      if (picked) expect(dryRunRejects(picked, state)).toBe(false);
    }
  });

  it('rejects when the resulting inventory would drop below the 3-vowel-quality floor', () => {
    // Exactly 3 vowel qualities (e, i, a) and 12 consonants (well over the
    // 8-consonant floor). raising-e (e > i) merges the lexicon's only /e/
    // into /i/ without creating a homophone (no pre-existing "pi"), so this
    // specifically exercises the inventory-floor guardrail rather than the
    // homophone-count one.
    const state: LangState = {
      lexicon: lexiconFrom({ a: 'pe', b: 'ti', c: 'ka', d: 'ma', e: 'na', f: 'sa', g: 'la', h: 'ra', i: 'fa', j: 'ha', k: 'va', l: 'da' }),
      changeHistory: [],
    };
    expect(dryRunRejects(getChange('raising-e'), state)).toBe(true);
  });
});

describe('sampleChange determinism', () => {
  it('same seed and state produce the same result', () => {
    const state: LangState = { lexicon: lexiconFrom({ a: 'kata', b: 'pisa', c: 'mola', d: 'ratu' }), changeHistory: [] };
    const a = sampleChange(state, new Stream(7));
    const b = sampleChange(state, new Stream(7));
    expect(a?.id ?? null).toBe(b?.id ?? null);
  });
});
