// Feature-based segment model, inventory generation, and phonotactics.
//
// Segments are feature bundles rather than symbol strings — this is the key
// upgrade over prototype/etymon.mjs, and it's what lets M2's sound changes
// target *features* ("all voiceless stops", "front vowels") instead of
// hand-listing symbols.

import type { Stream } from './prng.js';

export type Place = 'labial' | 'dental' | 'alveolar' | 'postalveolar' | 'palatal' | 'velar' | 'glottal';
export type Manner = 'stop' | 'affricate' | 'fricative' | 'nasal' | 'rhotic' | 'lateral' | 'glide';
export type Height = 'high' | 'mid' | 'low';
export type Backness = 'front' | 'central' | 'back';

export type Consonant = {
  type: 'C';
  place: Place;
  manner: Manner;
  voiced: boolean;
};

export type Vowel = {
  type: 'V';
  height: Height;
  backness: Backness;
  rounded: boolean;
  long: boolean; // proto-languages may or may not contrast length
  nasal: boolean; // always false at generation time; sound changes create it later
};

export type Segment = Consonant | Vowel;

export type Word = { segments: Segment[]; stress: number }; // index of stressed vowel segment

// ------------------------------------------------------------------ helpers

export function isConsonant(seg: Segment): seg is Consonant {
  return seg.type === 'C';
}

export function isVowel(seg: Segment): seg is Vowel {
  return seg.type === 'V';
}

/** Canonical, order-independent string key for a segment. Used for equality,
 * set membership, and Map keys — never for display. */
export function segKey(seg: Segment): string {
  if (seg.type === 'C') {
    return `C:${seg.place}:${seg.manner}:${seg.voiced ? '1' : '0'}`;
  }
  return `V:${seg.height}:${seg.backness}:${seg.rounded ? '1' : '0'}:${seg.long ? '1' : '0'}:${seg.nasal ? '1' : '0'}`;
}

/** Canonical string key for a whole word (segments + stress position). */
export function wordKey(word: Word): string {
  return `${word.segments.map(segKey).join('.')}#${word.stress}`;
}

/** Two words are "near collisions" if they are identical except that
 * exactly one vowel differs only in its `long` feature. */
export function isNearCollision(a: Word, b: Word): boolean {
  if (a.segments.length !== b.segments.length) return false;
  let diffCount = 0;
  for (let i = 0; i < a.segments.length; i++) {
    const sa = a.segments[i]!;
    const sb = b.segments[i]!;
    if (segKey(sa) === segKey(sb)) continue;
    if (sa.type !== 'V' || sb.type !== 'V') return false;
    // Differ in something other than length? then not a near collision.
    const sameQuality =
      sa.height === sb.height && sa.backness === sb.backness && sa.rounded === sb.rounded && sa.nasal === sb.nasal;
    if (!sameQuality || sa.long === sb.long) return false;
    diffCount++;
    if (diffCount > 1) return false;
  }
  return diffCount === 1;
}

// -------------------------------------------------------------- symbol table

const CONSONANT_TABLE: ReadonlyArray<{ seg: Omit<Consonant, 'type'>; symbol: string }> = [
  { seg: { place: 'labial', manner: 'stop', voiced: false }, symbol: 'p' },
  { seg: { place: 'alveolar', manner: 'stop', voiced: false }, symbol: 't' },
  { seg: { place: 'velar', manner: 'stop', voiced: false }, symbol: 'k' },
  { seg: { place: 'labial', manner: 'stop', voiced: true }, symbol: 'b' },
  { seg: { place: 'alveolar', manner: 'stop', voiced: true }, symbol: 'd' },
  { seg: { place: 'velar', manner: 'stop', voiced: true }, symbol: 'g' },
  { seg: { place: 'labial', manner: 'fricative', voiced: false }, symbol: 'f' },
  { seg: { place: 'alveolar', manner: 'fricative', voiced: false }, symbol: 's' },
  { seg: { place: 'glottal', manner: 'fricative', voiced: false }, symbol: 'h' },
  { seg: { place: 'postalveolar', manner: 'fricative', voiced: false }, symbol: 'sh' },
  { seg: { place: 'labial', manner: 'fricative', voiced: true }, symbol: 'v' },
  { seg: { place: 'alveolar', manner: 'fricative', voiced: true }, symbol: 'z' },
  { seg: { place: 'postalveolar', manner: 'affricate', voiced: false }, symbol: 'ch' },
  { seg: { place: 'postalveolar', manner: 'affricate', voiced: true }, symbol: 'j' },
  { seg: { place: 'labial', manner: 'nasal', voiced: true }, symbol: 'm' },
  { seg: { place: 'alveolar', manner: 'nasal', voiced: true }, symbol: 'n' },
  { seg: { place: 'alveolar', manner: 'rhotic', voiced: true }, symbol: 'r' },
  { seg: { place: 'alveolar', manner: 'lateral', voiced: true }, symbol: 'l' },
  { seg: { place: 'labial', manner: 'glide', voiced: true }, symbol: 'w' },
  { seg: { place: 'palatal', manner: 'glide', voiced: true }, symbol: 'y' },
];

const SCHWA: Omit<Vowel, 'type' | 'long'> = { height: 'mid', backness: 'central', rounded: false, nasal: false };

// Nasal is excluded from this key on purpose: the table only holds oral
// qualities (M1 never generates nasal vowels), and nasal vowels created
// later by M2's sound changes are looked up by their oral base quality,
// then get a trailing '~' appended in symbolFor — matching romanize.ts's
// NASAL_MARK convention. Keying on nasal would make every nasal quality an
// unrecognized symbol.
function baseVowelKey(v: Omit<Vowel, 'type' | 'long' | 'nasal'>): string {
  return `${v.height}:${v.backness}:${v.rounded ? '1' : '0'}`;
}

const VOWEL_SYMBOLS = new Map<string, string>([
  [baseVowelKey({ height: 'high', backness: 'front', rounded: false }), 'i'],
  [baseVowelKey({ height: 'mid', backness: 'front', rounded: false }), 'e'],
  [baseVowelKey({ height: 'low', backness: 'central', rounded: false }), 'a'],
  [baseVowelKey({ height: 'mid', backness: 'back', rounded: true }), 'o'],
  [baseVowelKey({ height: 'high', backness: 'back', rounded: true }), 'u'],
  [baseVowelKey(SCHWA), 'ë'], // ë, matching romanize.ts's schwa symbol
  [baseVowelKey({ height: 'high', backness: 'front', rounded: true }), 'ü'], // ü (vowel /y/)
  [baseVowelKey({ height: 'mid', backness: 'front', rounded: true }), 'ö'], // ö (vowel /ø/)
]);

const CONSONANT_SYMBOLS = new Map<string, string>(
  CONSONANT_TABLE.map(({ seg, symbol }) => [
    segKey({ type: 'C', ...seg }),
    symbol,
  ]),
);

/** Small IPA-ish symbol table for debugging/printing. Not every feature
 * bundle has a symbol; unknown ones render as a bracketed abbreviation. */
export function symbolFor(seg: Segment): string {
  if (seg.type === 'C') {
    return CONSONANT_SYMBOLS.get(segKey(seg)) ?? `[${segKey(seg)}]`;
  }
  const base = VOWEL_SYMBOLS.get(baseVowelKey(seg));
  if (!base) return `[${segKey(seg)}]`;
  const withLength = seg.long ? base + base : base;
  return seg.nasal ? withLength + '~' : withLength;
}

// ---------------------------------------------------------------- inventory

export type Phonotactics = {
  maxOnset: 1 | 2; // 2 with 40% probability; cluster = {stop,fricative} + {liquid,glide}
  codas: Consonant[]; // subset: nasals + /s/ always allowed if present; liquids 60%; stops 40%
  allowFinalVowel: boolean; // 90% true
};

export type Inventory = {
  consonants: Consonant[];
  vowels: Vowel[];
  phonotactics: Phonotactics;
};

const C = (place: Place, manner: Manner, voiced: boolean): Consonant => ({ type: 'C', place, manner, voiced });

const P = C('labial', 'stop', false);
const T = C('alveolar', 'stop', false);
const K = C('velar', 'stop', false);
const B = C('labial', 'stop', true);
const D = C('alveolar', 'stop', true);
const G = C('velar', 'stop', true);
const F = C('labial', 'fricative', false);
const S = C('alveolar', 'fricative', false);
const H = C('glottal', 'fricative', false);
const SH = C('postalveolar', 'fricative', false);
const VV = C('labial', 'fricative', true);
const Z = C('alveolar', 'fricative', true);
const CH = C('postalveolar', 'affricate', false);
const JJ = C('postalveolar', 'affricate', true);
const M = C('labial', 'nasal', true);
const N = C('alveolar', 'nasal', true);
const R = C('alveolar', 'rhotic', true);
const L = C('alveolar', 'lateral', true);
const W = C('labial', 'glide', true);
const Y = C('palatal', 'glide', true);

function vowelQualities(system: '3' | '4' | '5' | '6' | '7'): Array<Omit<Vowel, 'type' | 'long'>> {
  const i = { height: 'high' as const, backness: 'front' as const, rounded: false, nasal: false };
  const e = { height: 'mid' as const, backness: 'front' as const, rounded: false, nasal: false };
  const a = { height: 'low' as const, backness: 'central' as const, rounded: false, nasal: false };
  const o = { height: 'mid' as const, backness: 'back' as const, rounded: true, nasal: false };
  const u = { height: 'high' as const, backness: 'back' as const, rounded: true, nasal: false };
  const schwa = { ...SCHWA };
  const y = { height: 'high' as const, backness: 'front' as const, rounded: true, nasal: false };
  const oe = { height: 'mid' as const, backness: 'front' as const, rounded: true, nasal: false };
  switch (system) {
    case '3':
      return [i, a, u];
    case '4':
      return [i, e, a, o];
    case '5':
      return [i, e, a, o, u];
    case '6':
      return [i, e, a, o, u, schwa];
    case '7':
      return [i, e, a, o, u, y, oe];
  }
}

const MIN_CONSONANTS = 12;
const MAX_CONSONANTS = 22;
const MAX_INVENTORY_ATTEMPTS = 500;

function sampleConsonants(stream: Stream): Consonant[] {
  const cons: Consonant[] = [P, T, K];
  const voicedStops = stream.chance(0.6);
  if (voicedStops) cons.push(B, D, G);

  cons.push(S);
  if (stream.chance(0.7)) cons.push(F);
  if (stream.chance(0.6)) cons.push(H);
  if (stream.chance(0.35)) cons.push(SH);
  if (voicedStops && stream.chance(0.4)) cons.push(Z);
  if (voicedStops && stream.chance(0.4)) cons.push(VV);

  if (stream.chance(0.25)) {
    cons.push(CH);
    if (voicedStops) cons.push(JJ);
  }

  cons.push(M, N);

  const hasR = stream.chance(0.7);
  const hasL = stream.chance(0.7);
  if (hasR) cons.push(R);
  if (hasL) cons.push(L);
  if (!hasR && !hasL) cons.push(stream.pick([R, L]));

  if (stream.chance(0.65)) cons.push(W);
  if (stream.chance(0.65)) cons.push(Y);

  return cons;
}

function sampleVowels(stream: Stream): Vowel[] {
  const system = stream.weightedPick<'3' | '4' | '5' | '6' | '7'>([
    ['5', 0.45],
    ['3', 0.2],
    ['6', 0.15],
    ['7', 0.1],
    ['4', 0.1],
  ]);
  const qualities = vowelQualities(system);
  const hasLength = stream.chance(0.35);
  const vowels: Vowel[] = [];
  for (const q of qualities) {
    vowels.push({ type: 'V', ...q, long: false });
    if (hasLength) vowels.push({ type: 'V', ...q, long: true });
  }
  return vowels;
}

function samplePhonotactics(stream: Stream, consonants: Consonant[]): Phonotactics {
  const maxOnset: 1 | 2 = stream.chance(0.4) ? 2 : 1;
  const has = (seg: Consonant): boolean => consonants.some((c) => segKey(c) === segKey(seg));

  const codas: Consonant[] = [];
  for (const nasal of [M, N]) if (has(nasal)) codas.push(nasal);
  if (has(S)) codas.push(S);
  for (const liquid of [R, L]) if (has(liquid) && stream.chance(0.6)) codas.push(liquid);
  for (const stop of [P, T, K, B, D, G]) if (has(stop) && stream.chance(0.4)) codas.push(stop);

  const allowFinalVowel = stream.chance(0.9);
  return { maxOnset, codas, allowFinalVowel };
}

/** Generate a plausible phoneme inventory + phonotactics, respecting the
 * implicational universals described in specs/M1.md. */
export function generateInventory(stream: Stream): Inventory {
  for (let attempt = 0; attempt < MAX_INVENTORY_ATTEMPTS; attempt++) {
    const consonants = sampleConsonants(stream);
    if (consonants.length < MIN_CONSONANTS || consonants.length > MAX_CONSONANTS) continue;
    const vowels = sampleVowels(stream);
    const phonotactics = samplePhonotactics(stream, consonants);
    return { consonants, vowels, phonotactics };
  }
  throw new Error('generateInventory: could not sample a consonant inventory within bounds');
}

// ---------------------------------------------------------------- syllables

/** A syllable is a half-open segment index range [start, end) plus the
 * index of its vowel nucleus. Consonant-run boundaries between two nuclei
 * are split at the midpoint (a coarse but adequate approximation for M2's
 * stress/syncope logic, which only cares about "is this vowel word-medial
 * and singly-flanked" — see specs/M2.md's syllabify note). */
export type Syllable = { start: number; end: number; nucleus: number };

/** Split `word` into syllables, one per vowel. Only used by M2's sound-change
 * layer for stress-shift bookkeeping; rule *environments* never consult
 * syllable structure directly (specs/M2.md: "no syllable structure in v1
 * environments"). */
export function syllabify(word: Word): Syllable[] {
  const segs = word.segments;
  const nuclei: number[] = [];
  segs.forEach((s, i) => {
    if (isVowel(s)) nuclei.push(i);
  });
  if (nuclei.length === 0) return [];
  const syllables: Syllable[] = [];
  for (let n = 0; n < nuclei.length; n++) {
    const nucleus = nuclei[n]!;
    const start = n === 0 ? 0 : Math.floor((nuclei[n - 1]! + nucleus) / 2) + 1;
    const end = n === nuclei.length - 1 ? segs.length : Math.floor((nucleus + nuclei[n + 1]!) / 2) + 1;
    syllables.push({ start, end, nucleus });
  }
  return syllables;
}

// ------------------------------------------------------------ legal words

const ONSET_FIRST: ReadonlySet<Manner> = new Set(['stop', 'fricative']);
const ONSET_SECOND: ReadonlySet<Manner> = new Set(['rhotic', 'lateral', 'glide']);

function isLegalOnsetCluster(segs: Consonant[]): boolean {
  if (segs.length === 0) return true;
  if (segs.length === 1) return true;
  if (segs.length === 2) {
    return ONSET_FIRST.has(segs[0]!.manner) && ONSET_SECOND.has(segs[1]!.manner);
  }
  return false;
}

/** Check whether `word` is a phonotactically legal word of `phonotactics`.
 * Syllabification: onset* nucleus(vowel-run) coda*, greedily, with
 * maximal-onset resolution of medial consonant runs. */
export function isLegalWord(word: Word, phonotactics: Phonotactics): boolean {
  const segs = word.segments;
  if (segs.length === 0) return false;
  if (!segs.some(isVowel)) return false;

  const codaKeys = new Set(phonotactics.codas.map(segKey));
  const isLegalCoda = (c: Consonant): boolean => codaKeys.has(segKey(c));

  // Split into alternating consonant-runs / vowel-runs.
  type Run = { cons: boolean; segs: Segment[] };
  const runs: Run[] = [];
  for (const seg of segs) {
    const cons = isConsonant(seg);
    const last = runs[runs.length - 1];
    if (last && last.cons === cons) last.segs.push(seg);
    else runs.push({ cons, segs: [seg] });
  }

  if (runs.length === 0) return false;

  // Word-initial consonant run = onset of syllable 1 (may be empty if the
  // first run is a vowel run).
  let idx = 0;
  let sawNucleus = false;
  const firstRun = runs[0]!;
  if (firstRun.cons) {
    if (firstRun.segs.length > phonotactics.maxOnset) return false;
    if (!isLegalOnsetCluster(firstRun.segs as Consonant[])) return false;
    idx = 1;
  } else {
    if (firstRun.segs.length > 0) sawNucleus = true; // handled below in loop
  }

  for (; idx < runs.length; idx++) {
    const run = runs[idx]!;
    if (!run.cons) {
      sawNucleus = true;
      continue;
    }
    const isFinal = idx === runs.length - 1;
    if (isFinal) {
      // Final coda: at most one consonant, must be an allowed coda.
      if (run.segs.length > 1) return false;
      if (run.segs.length === 1 && !isLegalCoda(run.segs[0] as Consonant)) return false;
    } else {
      // Medial run: split into coda (0/1) + onset (per maxOnset), preferring
      // maximal onset.
      const cs = run.segs as Consonant[];
      let split = false;
      for (let codaLen = 0; codaLen <= 1 && !split; codaLen++) {
        const onsetLen = cs.length - codaLen;
        if (onsetLen < 1 || onsetLen > phonotactics.maxOnset) continue;
        const codaPart = cs.slice(0, codaLen);
        const onsetPart = cs.slice(codaLen);
        if (codaPart.length === 1 && !isLegalCoda(codaPart[0]!)) continue;
        if (!isLegalOnsetCluster(onsetPart)) continue;
        split = true;
      }
      if (!split) return false;
    }
  }

  if (!sawNucleus) return false;

  const lastSeg = segs[segs.length - 1]!;
  if (isVowel(lastSeg) && !phonotactics.allowFinalVowel) return false;

  return true;
}
