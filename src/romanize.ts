// A single default romanization (per-language orthographies are M7).
//
// Long vowels double the letter; /j/ (glide) -> y; /ʃ tʃ dʒ/ -> sh ch j;
// /y ø/ -> ü ö; /ə/ -> ë.
//
// Round-trip: parse(romanize(w)) must equal w for every word this milestone
// can generate. Two amibiguities are possible in principle — a coda /s/
// immediately followed by an onset /h/ would spell the same digraph as a
// single /ʃ/ ("sh"), and two adjacent vowels of the same quality (e.g. at a
// compound or affix boundary) would spell the same as one long vowel — so
// romanize() inserts a minimal apostrophe separator at any segment boundary
// that would otherwise be ambiguous, and parse() skips apostrophes. Stress
// is not marked orthographically; every word this milestone generates uses
// the initial-stress convention, so parse() reconstructs stress as the
// index of the first vowel, which round-trips correctly for all of them.

import { type Consonant, type Segment, type Vowel, type Word, isConsonant, isVowel } from './phonology.js';

type ConsonantQuality = Omit<Consonant, 'type'>;
type VowelQuality = Omit<Vowel, 'type' | 'long'>;

const CONSONANTS: ReadonlyArray<{ q: ConsonantQuality; symbol: string }> = [
  { q: { place: 'labial', manner: 'stop', voiced: false }, symbol: 'p' },
  { q: { place: 'alveolar', manner: 'stop', voiced: false }, symbol: 't' },
  { q: { place: 'velar', manner: 'stop', voiced: false }, symbol: 'k' },
  { q: { place: 'labial', manner: 'stop', voiced: true }, symbol: 'b' },
  { q: { place: 'alveolar', manner: 'stop', voiced: true }, symbol: 'd' },
  { q: { place: 'velar', manner: 'stop', voiced: true }, symbol: 'g' },
  { q: { place: 'labial', manner: 'fricative', voiced: false }, symbol: 'f' },
  { q: { place: 'alveolar', manner: 'fricative', voiced: false }, symbol: 's' },
  { q: { place: 'glottal', manner: 'fricative', voiced: false }, symbol: 'h' },
  { q: { place: 'postalveolar', manner: 'fricative', voiced: false }, symbol: 'sh' },
  { q: { place: 'labial', manner: 'fricative', voiced: true }, symbol: 'v' },
  { q: { place: 'alveolar', manner: 'fricative', voiced: true }, symbol: 'z' },
  { q: { place: 'postalveolar', manner: 'affricate', voiced: false }, symbol: 'ch' },
  { q: { place: 'postalveolar', manner: 'affricate', voiced: true }, symbol: 'j' },
  { q: { place: 'labial', manner: 'nasal', voiced: true }, symbol: 'm' },
  { q: { place: 'alveolar', manner: 'nasal', voiced: true }, symbol: 'n' },
  { q: { place: 'alveolar', manner: 'rhotic', voiced: true }, symbol: 'r' },
  { q: { place: 'alveolar', manner: 'lateral', voiced: true }, symbol: 'l' },
  { q: { place: 'labial', manner: 'glide', voiced: true }, symbol: 'w' },
  { q: { place: 'palatal', manner: 'glide', voiced: true }, symbol: 'y' },
];

const VOWELS: ReadonlyArray<{ q: VowelQuality; symbol: string }> = [
  { q: { height: 'high', backness: 'front', rounded: false, nasal: false }, symbol: 'i' },
  { q: { height: 'mid', backness: 'front', rounded: false, nasal: false }, symbol: 'e' },
  { q: { height: 'low', backness: 'central', rounded: false, nasal: false }, symbol: 'a' },
  { q: { height: 'mid', backness: 'back', rounded: true, nasal: false }, symbol: 'o' },
  { q: { height: 'high', backness: 'back', rounded: true, nasal: false }, symbol: 'u' },
  { q: { height: 'mid', backness: 'central', rounded: false, nasal: false }, symbol: 'ë' },
  { q: { height: 'high', backness: 'front', rounded: true, nasal: false }, symbol: 'ü' },
  { q: { height: 'mid', backness: 'front', rounded: true, nasal: false }, symbol: 'ö' },
];

function consonantKey(q: ConsonantQuality): string {
  return `${q.place}:${q.manner}:${q.voiced ? '1' : '0'}`;
}
function vowelKey(q: VowelQuality): string {
  return `${q.height}:${q.backness}:${q.rounded ? '1' : '0'}:${q.nasal ? '1' : '0'}`;
}

const CONSONANT_TO_SYMBOL = new Map<string, string>(CONSONANTS.map(({ q, symbol }) => [consonantKey(q), symbol]));
const SYMBOL_TO_CONSONANT = new Map<string, ConsonantQuality>(CONSONANTS.map(({ q, symbol }) => [symbol, q]));
const VOWEL_TO_SYMBOL = new Map<string, string>(VOWELS.map(({ q, symbol }) => [vowelKey(q), symbol]));
const SYMBOL_TO_VOWEL = new Map<string, VowelQuality>(VOWELS.map(({ q, symbol }) => [symbol, q]));

const RESERVED_DIGRAPHS = new Set(['sh', 'ch']);
const SEPARATOR = "'";

function symbolFor(seg: Segment): string {
  if (isConsonant(seg)) {
    const symbol = CONSONANT_TO_SYMBOL.get(consonantKey(seg));
    if (!symbol) throw new Error(`romanize: no symbol for consonant ${JSON.stringify(seg)}`);
    return symbol;
  }
  const base = VOWEL_TO_SYMBOL.get(vowelKey(seg));
  if (!base) throw new Error(`romanize: no symbol for vowel ${JSON.stringify(seg)}`);
  return seg.long ? base + base : base;
}

/** Would concatenating symbolA directly before symbolB (both from distinct
 * segments) be mis-tokenized by parse()? True if they'd spell a reserved
 * consonant digraph, or if two adjacent vowels would spell a false long
 * vowel. */
function needsSeparator(prev: Segment, prevSymbol: string, next: Segment, nextSymbol: string): boolean {
  const lastChar = prevSymbol[prevSymbol.length - 1]!;
  const firstChar = nextSymbol[0]!;
  if (isConsonant(prev) && isConsonant(next)) {
    return RESERVED_DIGRAPHS.has(lastChar + firstChar);
  }
  if (isVowel(prev) && isVowel(next)) {
    return lastChar === firstChar;
  }
  return false;
}

export function romanize(word: Word): string {
  let out = '';
  let prevSeg: Segment | null = null;
  let prevSymbol = '';
  for (const seg of word.segments) {
    const symbol = symbolFor(seg);
    if (prevSeg && needsSeparator(prevSeg, prevSymbol, seg, symbol)) {
      out += SEPARATOR;
    }
    out += symbol;
    prevSeg = seg;
    prevSymbol = symbol;
  }
  return out;
}

const VOWEL_LETTERS = new Set(VOWELS.map((v) => v.symbol));

/** Inverse of romanize(). Reconstructs segments by greedy tokenization
 * (2-char consonant digraphs, then doubled-vowel-letter length, then single
 * characters), skipping the apostrophe separator. Stress is set to the
 * index of the first vowel segment (see module doc). */
export function parse(s: string): Word {
  const segments: Segment[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === SEPARATOR) {
      i += 1;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two.length === 2 && RESERVED_DIGRAPHS.has(two)) {
      const q = SYMBOL_TO_CONSONANT.get(two);
      if (!q) throw new Error(`parse: unknown digraph "${two}"`);
      segments.push({ type: 'C', ...q });
      i += 2;
      continue;
    }
    if (VOWEL_LETTERS.has(c) && s[i + 1] === c) {
      const q = SYMBOL_TO_VOWEL.get(c);
      if (!q) throw new Error(`parse: unknown vowel letter "${c}"`);
      segments.push({ type: 'V', ...q, long: true });
      i += 2;
      continue;
    }
    if (VOWEL_LETTERS.has(c)) {
      const q = SYMBOL_TO_VOWEL.get(c);
      if (!q) throw new Error(`parse: unknown vowel letter "${c}"`);
      segments.push({ type: 'V', ...q, long: false });
      i += 1;
      continue;
    }
    const q = SYMBOL_TO_CONSONANT.get(c);
    if (!q) throw new Error(`parse: unrecognized character "${c}" in "${s}"`);
    segments.push({ type: 'C', ...q });
    i += 1;
  }
  const stress = segments.findIndex(isVowel);
  return { segments, stress: stress < 0 ? 0 : stress };
}
