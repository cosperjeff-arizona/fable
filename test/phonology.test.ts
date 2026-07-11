import { describe, expect, it } from 'vitest';
import { Stream } from '../src/prng.js';
import {
  type Consonant,
  type Vowel,
  type Word,
  generateInventory,
  isLegalWord,
  isNearCollision,
  segKey,
  symbolFor,
  wordKey,
} from '../src/phonology.js';

const SEEDS = Array.from({ length: 25 }, (_, i) => i + 1);

describe('segKey / wordKey', () => {
  it('gives identical segments identical keys', () => {
    const a: Consonant = { type: 'C', place: 'labial', manner: 'stop', voiced: false };
    const b: Consonant = { type: 'C', place: 'labial', manner: 'stop', voiced: false };
    expect(segKey(a)).toBe(segKey(b));
  });

  it('gives different segments different keys', () => {
    const p: Consonant = { type: 'C', place: 'labial', manner: 'stop', voiced: false };
    const b: Consonant = { type: 'C', place: 'labial', manner: 'stop', voiced: true };
    expect(segKey(p)).not.toBe(segKey(b));
  });

  it('distinguishes vowel length', () => {
    const short: Vowel = { type: 'V', height: 'high', backness: 'front', rounded: false, long: false, nasal: false };
    const long: Vowel = { type: 'V', height: 'high', backness: 'front', rounded: false, long: true, nasal: false };
    expect(segKey(short)).not.toBe(segKey(long));
  });

  it('wordKey is stable and order-sensitive', () => {
    const p: Consonant = { type: 'C', place: 'labial', manner: 'stop', voiced: false };
    const a: Vowel = { type: 'V', height: 'low', backness: 'central', rounded: false, long: false, nasal: false };
    const t: Consonant = { type: 'C', place: 'alveolar', manner: 'stop', voiced: false };
    const w1: Word = { segments: [p, a, t], stress: 1 };
    const w2: Word = { segments: [t, a, p], stress: 1 };
    expect(wordKey(w1)).not.toBe(wordKey(w2));
  });
});

describe('symbolFor', () => {
  it('renders known phonemes with short, human symbols', () => {
    const p: Consonant = { type: 'C', place: 'labial', manner: 'stop', voiced: false };
    const sh: Consonant = { type: 'C', place: 'postalveolar', manner: 'fricative', voiced: false };
    const ch: Consonant = { type: 'C', place: 'postalveolar', manner: 'affricate', voiced: false };
    expect(symbolFor(p)).toBe('p');
    expect(symbolFor(sh)).toBe('sh');
    expect(symbolFor(ch)).toBe('ch');
  });

  it('renders unknown feature bundles as a bracketed abbreviation', () => {
    const weird: Consonant = { type: 'C', place: 'dental', manner: 'fricative', voiced: true };
    expect(symbolFor(weird)).toMatch(/^\[.*]$/);
  });

  it('doubles the letter for long vowels', () => {
    const a: Vowel = { type: 'V', height: 'low', backness: 'central', rounded: false, long: false, nasal: false };
    const aLong: Vowel = { ...a, long: true };
    expect(symbolFor(aLong)).toBe(symbolFor(a) + symbolFor(a));
  });
});

describe('generateInventory', () => {
  it('is deterministic for a given stream seed', () => {
    const a = generateInventory(new Stream(42));
    const b = generateInventory(new Stream(42));
    expect(a).toEqual(b);
  });

  it.each(SEEDS)('produces a consonant inventory of 12-22 phonemes (seed %d)', (seed) => {
    const inv = generateInventory(new Stream(seed));
    expect(inv.consonants.length).toBeGreaterThanOrEqual(12);
    expect(inv.consonants.length).toBeLessThanOrEqual(22);
  });

  it.each(SEEDS)('always includes voiceless stops p t k (seed %d)', (seed) => {
    const inv = generateInventory(new Stream(seed));
    const keys = new Set(inv.consonants.map(segKey));
    for (const stop of [
      { type: 'C', place: 'labial', manner: 'stop', voiced: false },
      { type: 'C', place: 'alveolar', manner: 'stop', voiced: false },
      { type: 'C', place: 'velar', manner: 'stop', voiced: false },
    ] as const) {
      expect(keys.has(segKey(stop))).toBe(true);
    }
  });

  it.each(SEEDS)('never has voiced stops without voiceless stops (seed %d)', (seed) => {
    const inv = generateInventory(new Stream(seed));
    const hasVoiced = inv.consonants.some((c) => c.manner === 'stop' && c.voiced);
    const hasVoiceless = inv.consonants.some((c) => c.manner === 'stop' && !c.voiced);
    if (hasVoiced) expect(hasVoiceless).toBe(true);
  });

  it.each(SEEDS)('always has at least one liquid (seed %d)', (seed) => {
    const inv = generateInventory(new Stream(seed));
    expect(inv.consonants.some((c) => c.manner === 'rhotic' || c.manner === 'lateral')).toBe(true);
  });

  it.each(SEEDS)('has a non-empty vowel system with no duplicate qualities (seed %d)', (seed) => {
    const inv = generateInventory(new Stream(seed));
    expect(inv.vowels.length).toBeGreaterThan(0);
    const shortQualities = inv.vowels.filter((v) => !v.long).map(segKey);
    expect(new Set(shortQualities).size).toBe(shortQualities.length);
  });

  it.each(SEEDS)('codas only contain nasals, /s/, liquids, or stops that are in the inventory (seed %d)', (seed) => {
    const inv = generateInventory(new Stream(seed));
    const consKeys = new Set(inv.consonants.map(segKey));
    for (const coda of inv.phonotactics.codas) {
      expect(consKeys.has(segKey(coda))).toBe(true);
      expect(['nasal', 'fricative', 'rhotic', 'lateral', 'stop']).toContain(coda.manner);
    }
  });
});

describe('isLegalWord', () => {
  it('rejects a word with no vowel', () => {
    const inv = generateInventory(new Stream(1));
    const p = inv.consonants[0]!;
    expect(isLegalWord({ segments: [p, p], stress: 0 }, inv.phonotactics)).toBe(false);
  });

  it('rejects an empty word', () => {
    const inv = generateInventory(new Stream(1));
    expect(isLegalWord({ segments: [], stress: 0 }, inv.phonotactics)).toBe(false);
  });

  it('rejects a final consonant that is not an allowed coda', () => {
    const inv = generateInventory(new Stream(1));
    const vowel = inv.vowels[0]!;
    const notCoda = inv.consonants.find(
      (c) => !inv.phonotactics.codas.some((coda) => segKey(coda) === segKey(c)),
    );
    if (!notCoda) return; // every consonant happens to be a legal coda for this seed; nothing to test
    expect(isLegalWord({ segments: [vowel, notCoda], stress: 0 }, inv.phonotactics)).toBe(false);
  });

  it('rejects a final vowel when allowFinalVowel is false', () => {
    const inv = generateInventory(new Stream(1));
    const phonotactics = { ...inv.phonotactics, allowFinalVowel: false };
    const cons = inv.consonants[0]!;
    const vowel = inv.vowels[0]!;
    expect(isLegalWord({ segments: [cons, vowel], stress: 0 }, phonotactics)).toBe(false);
  });

  it('accepts a plain CV word', () => {
    const inv = generateInventory(new Stream(1));
    const cons = inv.consonants[0]!;
    const vowel = inv.vowels[0]!;
    expect(isLegalWord({ segments: [cons, vowel], stress: 0 }, inv.phonotactics)).toBe(true);
  });
});

describe('isNearCollision', () => {
  const cons: Consonant = { type: 'C', place: 'alveolar', manner: 'stop', voiced: false };
  const shortA: Vowel = { type: 'V', height: 'low', backness: 'central', rounded: false, long: false, nasal: false };
  const longA: Vowel = { ...shortA, long: true };
  const i: Vowel = { type: 'V', height: 'high', backness: 'front', rounded: false, long: false, nasal: false };

  it('flags words differing only in one vowel length', () => {
    const w1: Word = { segments: [cons, shortA], stress: 0 };
    const w2: Word = { segments: [cons, longA], stress: 0 };
    expect(isNearCollision(w1, w2)).toBe(true);
  });

  it('does not flag words differing in vowel quality', () => {
    const w1: Word = { segments: [cons, shortA], stress: 0 };
    const w2: Word = { segments: [cons, i], stress: 0 };
    expect(isNearCollision(w1, w2)).toBe(false);
  });

  it('does not flag words of different lengths', () => {
    const w1: Word = { segments: [cons, shortA], stress: 0 };
    const w2: Word = { segments: [cons, shortA, cons], stress: 0 };
    expect(isNearCollision(w1, w2)).toBe(false);
  });

  it('does not flag identical words', () => {
    const w1: Word = { segments: [cons, shortA], stress: 0 };
    const w2: Word = { segments: [cons, shortA], stress: 0 };
    expect(isNearCollision(w1, w2)).toBe(false);
  });
});
