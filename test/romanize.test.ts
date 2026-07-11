import { describe, expect, it } from 'vitest';
import { Stream, makeStreams } from '../src/prng.js';
import { generateInventory, wordKey, type Word, type Consonant, type Vowel } from '../src/phonology.js';
import { generateLexicon } from '../src/lexicon.js';
import { CONCEPTS } from '../src/concepts.js';
import { parse, romanize } from '../src/romanize.js';

const p: Consonant = { type: 'C', place: 'labial', manner: 'stop', voiced: false };
const s: Consonant = { type: 'C', place: 'alveolar', manner: 'fricative', voiced: false };
const h: Consonant = { type: 'C', place: 'glottal', manner: 'fricative', voiced: false };
const sh: Consonant = { type: 'C', place: 'postalveolar', manner: 'fricative', voiced: false };
const a: Vowel = { type: 'V', height: 'low', backness: 'central', rounded: false, long: false, nasal: false };
const aLong: Vowel = { ...a, long: true };
const y: Vowel = { type: 'V', height: 'high', backness: 'front', rounded: true, long: false, nasal: false };
const oe: Vowel = { type: 'V', height: 'mid', backness: 'front', rounded: true, long: false, nasal: false };
const schwa: Vowel = { type: 'V', height: 'mid', backness: 'central', rounded: false, long: false, nasal: false };

describe('romanize', () => {
  it('doubles the letter for a long vowel', () => {
    expect(romanize({ segments: [p, aLong], stress: 1 })).toBe('paa');
  });

  it('renders ʃ tʃ dʒ as sh ch j', () => {
    expect(romanize({ segments: [a, sh, a], stress: 0 })).toBe('asha');
  });

  it('renders /y/ and /ø/ as ü and ö', () => {
    expect(romanize({ segments: [p, y], stress: 1 })).toBe('pü');
    expect(romanize({ segments: [p, oe], stress: 1 })).toBe('pö');
  });

  it('renders /ə/ as ë', () => {
    expect(romanize({ segments: [p, schwa], stress: 1 })).toBe('pë');
  });

  it('inserts a separator between a coda /s/ and onset /h/ to avoid the "sh" digraph', () => {
    const word: Word = { segments: [a, s, h, a], stress: 0 };
    const surface = romanize(word);
    expect(surface).not.toContain('sh');
    expect(surface).toBe("as'ha");
  });

  it('inserts a separator between two identical adjacent vowels to avoid a false long vowel', () => {
    const word: Word = { segments: [p, a, a], stress: 0 };
    const surface = romanize(word);
    expect(surface).toBe("pa'a");
  });
});

describe('parse', () => {
  it('is the inverse of romanize for hand-built words', () => {
    // parse() reconstructs stress as the index of the first vowel (see
    // module doc in src/romanize.ts), so hand-built fixtures must follow
    // that same convention for the round trip to hold.
    const segmentLists = [
      [p, a],
      [p, aLong],
      [a, sh, a],
      [p, y],
      [p, oe],
      [p, schwa],
      [a, s, h, a],
      [p, a, a],
    ];
    const words: Word[] = segmentLists.map((segments) => ({
      segments,
      stress: segments.findIndex((seg) => seg.type === 'V'),
    }));
    for (const w of words) {
      expect(wordKey(parse(romanize(w)))).toBe(wordKey(w));
    }
  });
});

describe('romanize/parse round trip over generated lexicons', () => {
  const seeds = Array.from({ length: 20 }, (_, i) => i + 1);

  it.each(seeds)('every lexeme round-trips through romanize/parse (seed %d)', (seed) => {
    const streams = makeStreams(seed);
    const inventory = generateInventory(streams.phonology);
    const lexicon = generateLexicon(inventory, CONCEPTS, streams.lexicon);
    for (const lexeme of lexicon.lexemes.values()) {
      const roundTripped = parse(romanize(lexeme.word));
      expect(wordKey(roundTripped)).toBe(wordKey(lexeme.word));
    }
    for (const affix of lexicon.affixes) {
      const firstVowel = affix.form.findIndex((seg) => seg.type === 'V');
      const asWord: Word = { segments: affix.form, stress: firstVowel < 0 ? 0 : firstVowel };
      const roundTripped = parse(romanize(asWord));
      expect(wordKey(roundTripped)).toBe(wordKey(asWord));
    }
  });
});
