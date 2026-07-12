// Per-language orthographic conventions (specs/M7.md's "Per-language
// orthographies").
//
// src/romanize.ts stays the single neutral phonemic romanization — every
// engine-internal comparison, every proto form (`*...`), and every JSON
// `romanized` field keeps using it. This module adds a SEPARATE, purely
// cosmetic layer on top: each leaf branch gets its own `Orthography` (a set
// of spelling-convention choices, e.g. does /k/ write as `k` or `c`?) sampled
// from a dedicated `orthography:<branchId>` stream family (src/prng.ts), and
// `spell(word, orthography)` renders a Word through those choices instead of
// the default table.
//
// Two things make this safe to bolt on late, per specs/M7.md:
//  1. The stream family is brand new and consumed nowhere else, so sampling
//     an Orthography (or not) can never perturb `generateSimulation`'s own
//     output — orthography is sampled at query/render time only.
//  2. `spell()` builds directly from a Word's segments; it never calls
//     romanize() or reuses its apostrophe-separator logic, so the morpheme
//     separator that can appear in phonemic romanization (specs/M5.md's
//     coined-compound boundary marker) and the nasal-vowel `~` marker never
//     appear in a leaf spelling — satisfying specs/M7.md's "no `~` or `'` in
//     leaf display" property without any extra bookkeeping. Digraph-looking
//     accidental collisions (e.g. an orthography that spells both /k/-before-
//     a-back-vowel and /tʃ/ as `c`) are accepted as an authentic orthographic
//     quirk, exactly like real natural-language spelling systems have —
//     spell() has no round-trip requirement, unlike romanize().

import { makeStreams, type Stream } from './prng.js';
import { type Consonant, type Segment, type Vowel, type Word, isConsonant, isVowel } from './phonology.js';
import type { Simulation } from './history.js';

// ------------------------------------------------------------- convention types

export type KStyle = 'k' | 'c'; // 'c' still writes /k/ as k before front vowels
export type AffricateVoicelessStyle = 'ch' | 'c' | 'tš'; // /tʃ/
export type AffricateVoicedStyle = 'j' | 'dj'; // /dʒ/
export type FricativePostalveolarStyle = 'sh' | 'š' | 'x'; // /ʃ/
export type GlideStyle = 'y' | 'j'; // /j/
export type FrontRoundedStyle = 'umlaut' | 'y-oe' | 'digraph'; // /y ø/: ü ö | y ö | ue oe
export type SchwaStyle = 'ë' | 'e' | 'ă'; // /ə/
export type LongVowelStyle = 'double' | 'macron';
export type NasalVowelStyle = 'tilde' | 'ogonek' | 'n-after';

export type Orthography = {
  k: KStyle;
  affricateVoiceless: AffricateVoicelessStyle;
  affricateVoiced: AffricateVoicedStyle;
  fricativePostalveolar: FricativePostalveolarStyle;
  glide: GlideStyle;
  frontRounded: FrontRoundedStyle;
  schwa: SchwaStyle;
  longVowel: LongVowelStyle;
  nasalVowel: NasalVowelStyle;
};

/**
 * Sample one branch's Orthography (specs/M7.md's convention list). Every
 * choice is drawn unconditionally, in a fixed order, whether or not a later
 * choice ends up overriding it — the same "consume the same shape of
 * randomness regardless of outcome" discipline src/drift.ts's `driftStep`
 * uses, so two branches' Orthography draws never accidentally desync from
 * each other or from anything else on the same stream.
 */
export function sampleOrthography(stream: Stream): Orthography {
  const k = stream.weightedPick<KStyle>([
    ['k', 0.6],
    ['c', 0.4],
  ]);
  const affricateVoiceless = stream.weightedPick<AffricateVoicelessStyle>([
    ['ch', 0.5],
    ['c', 0.25],
    ['tš', 0.25],
  ]);
  const affricateVoiced = stream.weightedPick<AffricateVoicedStyle>([
    ['j', 0.7],
    ['dj', 0.3],
  ]);
  const fricativePostalveolar = stream.weightedPick<FricativePostalveolarStyle>([
    ['sh', 0.5],
    ['š', 0.3],
    ['x', 0.2],
  ]);

  // /j/: y (60%) or j (40%, only if /dʒ/ isn't already spelled j). The draw
  // itself is unconditional; only the fallback is contingent on the earlier
  // affricateVoiced choice.
  const wantsGlideY = stream.chance(0.6);
  const glide: GlideStyle = wantsGlideY ? 'y' : affricateVoiced !== 'j' ? 'j' : 'y';

  // /y ø/: ü ö (50%) / y ö (25%, only if the glide isn't already y) / ue oe
  // (25%). Same discipline: draw unconditionally, then fall back to 'umlaut'
  // if the 'y-oe' result would collide with the glide's own 'y'.
  const frontRoundedDraw = stream.weightedPick<FrontRoundedStyle>([
    ['umlaut', 0.5],
    ['y-oe', 0.25],
    ['digraph', 0.25],
  ]);
  const frontRounded: FrontRoundedStyle = frontRoundedDraw === 'y-oe' && glide === 'y' ? 'umlaut' : frontRoundedDraw;

  const schwa = stream.weightedPick<SchwaStyle>([
    ['ë', 0.6],
    ['e', 0.25],
    ['ă', 0.15],
  ]);

  const longVowel: LongVowelStyle = stream.chance(0.6) ? 'double' : 'macron';

  const nasalVowel = stream.weightedPick<NasalVowelStyle>([
    ['tilde', 0.6],
    ['ogonek', 0.2],
    ['n-after', 0.2],
  ]);

  return { k, affricateVoiceless, affricateVoiced, fricativePostalveolar, glide, frontRounded, schwa, longVowel, nasalVowel };
}

/**
 * `sampleOrthography` off `sim`'s own `orthography:<branchId>` stream —
 * the standard way every other module (render.ts, serialize.ts) gets a
 * branch's Orthography. Deterministic and pure: since `makeStreams` derives
 * a fresh generator from `(seed, name)` every call, calling this twice for
 * the same `(sim.config.seed, branchId)` always returns the identical
 * Orthography, so callers never need to cache or thread one through.
 */
export function orthographyFor(sim: Simulation, branchId: string): Orthography {
  return sampleOrthography(makeStreams(sim.config.seed).orthography(branchId));
}

// -------------------------------------------------------------- symbol tables

type ConsonantQuality = Omit<Consonant, 'type'>;

function consonantKey(q: ConsonantQuality): string {
  return `${q.place}:${q.manner}:${q.voiced ? '1' : '0'}`;
}

/** Consonants whose spelling never varies by orthography — every consonant
 * except /k tʃ dʒ ʃ j/, which `consonantSymbol` below handles specially. */
const PLAIN_CONSONANTS: ReadonlyArray<{ q: ConsonantQuality; symbol: string }> = [
  { q: { place: 'labial', manner: 'stop', voiced: false }, symbol: 'p' },
  { q: { place: 'alveolar', manner: 'stop', voiced: false }, symbol: 't' },
  { q: { place: 'labial', manner: 'stop', voiced: true }, symbol: 'b' },
  { q: { place: 'alveolar', manner: 'stop', voiced: true }, symbol: 'd' },
  { q: { place: 'velar', manner: 'stop', voiced: true }, symbol: 'g' },
  { q: { place: 'labial', manner: 'fricative', voiced: false }, symbol: 'f' },
  { q: { place: 'alveolar', manner: 'fricative', voiced: false }, symbol: 's' },
  { q: { place: 'glottal', manner: 'fricative', voiced: false }, symbol: 'h' },
  { q: { place: 'labial', manner: 'fricative', voiced: true }, symbol: 'v' },
  { q: { place: 'alveolar', manner: 'fricative', voiced: true }, symbol: 'z' },
  { q: { place: 'labial', manner: 'nasal', voiced: true }, symbol: 'm' },
  { q: { place: 'alveolar', manner: 'nasal', voiced: true }, symbol: 'n' },
  { q: { place: 'alveolar', manner: 'rhotic', voiced: true }, symbol: 'r' },
  { q: { place: 'alveolar', manner: 'lateral', voiced: true }, symbol: 'l' },
  { q: { place: 'labial', manner: 'glide', voiced: true }, symbol: 'w' },
];

const PLAIN_CONSONANT_SYMBOLS = new Map<string, string>(PLAIN_CONSONANTS.map(({ q, symbol }) => [consonantKey(q), symbol]));

function isK(c: Consonant): boolean {
  return c.place === 'velar' && c.manner === 'stop' && !c.voiced;
}
function isVoicelessPostalveolarAffricate(c: Consonant): boolean {
  return c.place === 'postalveolar' && c.manner === 'affricate' && !c.voiced;
}
function isVoicedPostalveolarAffricate(c: Consonant): boolean {
  return c.place === 'postalveolar' && c.manner === 'affricate' && c.voiced;
}
function isVoicelessPostalveolarFricative(c: Consonant): boolean {
  return c.place === 'postalveolar' && c.manner === 'fricative' && !c.voiced;
}
function isPalatalGlide(c: Consonant): boolean {
  return c.place === 'palatal' && c.manner === 'glide';
}

function consonantSymbol(c: Consonant, o: Orthography, next: Segment | undefined): string {
  if (isK(c)) {
    if (o.k === 'k') return 'k';
    // 'c' style, but /k/ before a front vowel (i/e/y/ö) stays 'k' to keep
    // it readable (specs/M7.md).
    if (next && isVowel(next) && next.backness === 'front') return 'k';
    return 'c';
  }
  if (isVoicelessPostalveolarAffricate(c)) return o.affricateVoiceless;
  if (isVoicedPostalveolarAffricate(c)) return o.affricateVoiced;
  if (isVoicelessPostalveolarFricative(c)) return o.fricativePostalveolar;
  if (isPalatalGlide(c)) return o.glide;

  const symbol = PLAIN_CONSONANT_SYMBOLS.get(consonantKey(c));
  if (!symbol) throw new Error(`spell: no symbol for consonant ${JSON.stringify(c)}`);
  return symbol;
}

type VowelQuality = Omit<Vowel, 'type' | 'long' | 'nasal'>;

function vowelKey(q: VowelQuality): string {
  return `${q.height}:${q.backness}:${q.rounded ? '1' : '0'}`;
}

/** i/e/a/o/u never vary by orthography (specs/M7.md only lists conventions
 * for /k tʃ dʒ ʃ j y ø ə/ and length/nasality). */
const PLAIN_VOWEL_LETTERS = new Map<string, string>([
  [vowelKey({ height: 'high', backness: 'front', rounded: false }), 'i'],
  [vowelKey({ height: 'mid', backness: 'front', rounded: false }), 'e'],
  [vowelKey({ height: 'low', backness: 'central', rounded: false }), 'a'],
  [vowelKey({ height: 'mid', backness: 'back', rounded: true }), 'o'],
  [vowelKey({ height: 'high', backness: 'back', rounded: true }), 'u'],
]);

function isSchwa(v: Vowel): boolean {
  return v.height === 'mid' && v.backness === 'central' && !v.rounded;
}
function isHighFrontRounded(v: Vowel): boolean {
  return v.height === 'high' && v.backness === 'front' && v.rounded;
}
function isMidFrontRounded(v: Vowel): boolean {
  return v.height === 'mid' && v.backness === 'front' && v.rounded;
}

function vowelBaseLetters(v: Vowel, o: Orthography): string {
  if (isSchwa(v)) return o.schwa;
  if (isHighFrontRounded(v)) return o.frontRounded === 'umlaut' ? 'ü' : o.frontRounded === 'y-oe' ? 'y' : 'ue';
  if (isMidFrontRounded(v)) return o.frontRounded === 'digraph' ? 'oe' : 'ö';
  const letter = PLAIN_VOWEL_LETTERS.get(vowelKey(v));
  if (!letter) throw new Error(`spell: no letter for vowel ${JSON.stringify(v)}`);
  return letter;
}

// Combining marks (spec-silent generalization: applied uniformly to every
// vowel letter, including the multi-character ë/ü/ö/ue/oe spellings, rather
// than only the 5 cardinal vowels the spec's examples list precomposed forms
// for — this covers every quality with one implementation instead of a
// second lookup table, and renders visually identical to the precomposed
// forms for i/e/a/o/u).
const MACRON = '̄'; // combining macron, e.g. ā
const TILDE = '̃'; // combining tilde, e.g. ã
const OGONEK = '̨'; // combining ogonek, e.g. ą

/** True if spelling this nasal vowel as `<letter>n` would be genuinely
 * ambiguous with a real following /n/ consonant (specs/M7.md's "only when no
 * true /Vn/ ambiguity exists in that word — else fall back to tilde"). */
function hasTrueVNAmbiguity(segments: readonly Segment[], vowelIdx: number): boolean {
  const next = segments[vowelIdx + 1];
  return !!next && isConsonant(next) && next.place === 'alveolar' && next.manner === 'nasal';
}

function nasalSuffix(o: Orthography, segments: readonly Segment[], idx: number): string {
  if (o.nasalVowel === 'n-after') {
    return hasTrueVNAmbiguity(segments, idx) ? TILDE : 'n';
  }
  return o.nasalVowel === 'tilde' ? TILDE : OGONEK;
}

/**
 * Render `word` through `orthography`'s conventions. Unlike `romanize()`,
 * this never inserts a separator (see the module doc) and never produces the
 * `~` nasal marker — nasal vowels always get a real letter/diacritic instead.
 */
export function spell(word: Word, orthography: Orthography): string {
  const segs = word.segments;
  let out = '';
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    if (isConsonant(seg)) {
      out += consonantSymbol(seg, orthography, segs[i + 1]);
      continue;
    }
    const base = vowelBaseLetters(seg, orthography);
    let piece = seg.long ? (orthography.longVowel === 'double' ? base + base : base + MACRON) : base;
    if (seg.nasal) piece += nasalSuffix(orthography, segs, i);
    out += piece;
  }
  return out;
}
