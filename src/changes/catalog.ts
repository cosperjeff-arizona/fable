// The sound-change catalog (specs/M2.md's "The catalog"). 38 entries, each a
// factory `(stream) => SoundChange`. Every entry's `applicable()` requires,
// at minimum, that the change would alter at least one lexeme (via
// `anyLexemeAffected`) — this isn't always spelled out as a "Precondition:"
// line in the spec, but it keeps sampling from wasting dry-run attempts on
// changes that are no-ops for the current lexicon.
//
// Several entries need to say "this feature is one of {i, e, j, y}" or "this
// consonant equals its neighbor" — SegPattern only expresses conjunctions of
// exact feature values (no OR, no segment-to-segment equality), so those
// entries are implemented as several subRules, one per enumerated
// alternative. That's why hiatus-resolution/degemination/liquid-metathesis
// have a subRule per vowel/consonant quality rather than one generic rule.
//
// A handful of spec clauses read as state-dependent behavior ("long vowels
// first if length exists; else all", "e/o if no length") that a factory
// can't see, since factories only receive a Stream (specs/M2.md's literal
// type). Rather than plumbing LangState into every factory, those clauses
// are resolved the simplest way that stays faithful: patterns that omit the
// `long` key match short *and* long vowels uniformly (so "else all" is just
// what happens), and outputs that could be "long or short" are always
// produced long — which, when nothing was long before, is exactly how such
// changes plausibly *introduce* a length contrast. This is called out once
// here rather than per entry.

import type { Backness, Consonant, Height, Manner, Place, Segment, Vowel } from '../phonology.js';
import { isConsonant, isVowel } from '../phonology.js';
import type { Stream } from '../prng.js';
import { anyLexemeAffected } from './apply.js';
import {
  type ChangeFamily,
  type ContextAtom,
  type LangState,
  type SegPattern,
  type SoundChange,
  type SubRule,
  hasAdjacentPair,
  hasSegment,
  matchPattern,
  nasalVowelQualityCount,
  vowelQualityKeysInUse,
} from './rules.js';

// --------------------------------------------------------------- builders

const cp = (place: Place, manner: Manner, voiced: boolean): SegPattern => ({ type: 'C', place, manner, voiced });
const vp = (height: Height, backness: Backness, rounded: boolean, nasal = false): SegPattern => ({
  type: 'V',
  height,
  backness,
  rounded,
  nasal,
});
const cSeg = (place: Place, manner: Manner, voiced: boolean): Consonant => ({ type: 'C', place, manner, voiced });
const vSeg = (height: Height, backness: Backness, rounded: boolean, long = false, nasal = false): Vowel => ({
  type: 'V',
  height,
  backness,
  rounded,
  long,
  nasal,
});
const seg = (pattern: SegPattern): ContextAtom => ({ kind: 'seg', pattern });
const edge: ContextAtom = { kind: 'boundary' };

const ANY_V: SegPattern = { type: 'V' };
const ANY_C: SegPattern = { type: 'C' };

// Consonant quality shorthands, mirroring phonology.ts's symbol table.
const P = cp('labial', 'stop', false);
const T = cp('alveolar', 'stop', false);
const K = cp('velar', 'stop', false);
const B = cp('labial', 'stop', true);
const D = cp('alveolar', 'stop', true);
const G = cp('velar', 'stop', true);
const F = cp('labial', 'fricative', false);
const S = cp('alveolar', 'fricative', false);
const HH = cp('glottal', 'fricative', false);
const SHH = cp('postalveolar', 'fricative', false);
const VC = cp('labial', 'fricative', true);
const Z = cp('alveolar', 'fricative', true);
const CHC = cp('postalveolar', 'affricate', false);
const JJ = cp('postalveolar', 'affricate', true);
const NAS_M = cp('labial', 'nasal', true);
const NAS_N = cp('alveolar', 'nasal', true);
const RR = cp('alveolar', 'rhotic', true);
const LL = cp('alveolar', 'lateral', true);
const WW = cp('labial', 'glide', true);
const YY = cp('palatal', 'glide', true);

const ALL_CONSONANT_QUALITIES: SegPattern[] = [P, T, K, B, D, G, F, S, HH, SHH, VC, Z, CHC, JJ, NAS_M, NAS_N, RR, LL, WW, YY];

// Vowel quality shorthands.
const I = vp('high', 'front', false);
const E = vp('mid', 'front', false);
const A = vp('low', 'central', false);
const O = vp('mid', 'back', true);
const U = vp('high', 'back', true);
const SCHWA = vp('mid', 'central', false);
const UE = vp('high', 'front', true); // /y/, romanized ü
const OE = vp('mid', 'front', true); // /ø/, romanized ö

const ALL_VOWEL_QUALITIES_ORAL: SegPattern[] = [I, E, A, O, U, SCHWA, UE, OE];
const ALL_VOWEL_QUALITIES: SegPattern[] = [
  ...ALL_VOWEL_QUALITIES_ORAL,
  ...ALL_VOWEL_QUALITIES_ORAL.map((q) => ({ ...q, nasal: true })),
];

function vSegFromQuality(q: SegPattern, long: boolean): Vowel {
  return vSeg(q.height as Height, q.backness as Backness, q.rounded as boolean, long, (q.nasal as boolean) ?? false);
}

function sameConsonant(a: Segment, b: Segment): boolean {
  return isConsonant(a) && isConsonant(b) && a.place === b.place && a.manner === b.manner && a.voiced === b.voiced;
}

function sameVowelQuality(a: Segment, b: Segment): boolean {
  return (
    isVowel(a) && isVowel(b) && a.height === b.height && a.backness === b.backness && a.rounded === b.rounded && a.nasal === b.nasal
  );
}

function startsWithSC(state: LangState): boolean {
  for (const lexeme of state.lexicon.lexemes.values()) {
    const segs = lexeme.word.segments;
    if (segs.length < 2) continue;
    const first = segs[0]!;
    const second = segs[1]!;
    if (isConsonant(first) && first.place === 'alveolar' && first.manner === 'fricative' && !first.voiced && isConsonant(second)) {
      return true;
    }
  }
  return false;
}

// ------------------------------------------------------------- factory glue

type ApplicableExtra = (state: LangState) => boolean;

function makeChange(
  id: string,
  family: ChangeFamily,
  weight: number,
  description: string,
  subRules: SubRule[],
  extra?: ApplicableExtra,
): SoundChange {
  return {
    id,
    family,
    weight,
    describe: () => description,
    subRules,
    applicable: (state) => anyLexemeAffected(subRules, state.lexicon) && (extra ? extra(state) : true),
  };
}

export type CatalogFactory = (stream: Stream) => SoundChange;

// ------------------------------------------------------------------- 1-6

const voicing: CatalogFactory = () =>
  makeChange(
    'voicing',
    'lenition',
    1.3,
    'intervocalic voicing (p t k > b d g / V_V)',
    [P, T, K].map((c) => ({ match: c, env: { before: [seg(ANY_V)], after: [seg(ANY_V)] }, action: { kind: 'set', delta: { voiced: true } } })),
  );

const spirantization: CatalogFactory = () =>
  makeChange(
    'spirantization',
    'lenition',
    1.1,
    'intervocalic spirantization (b d g > v z h / V_V)',
    [
      { match: B, env: { before: [seg(ANY_V)], after: [seg(ANY_V)] }, action: { kind: 'set', delta: { manner: 'fricative' } } },
      { match: D, env: { before: [seg(ANY_V)], after: [seg(ANY_V)] }, action: { kind: 'set', delta: { manner: 'fricative' } } },
      {
        match: G,
        env: { before: [seg(ANY_V)], after: [seg(ANY_V)] },
        action: { kind: 'set', delta: { place: 'glottal', manner: 'fricative', voiced: false } },
      },
    ],
  );

const finalDevoicing: CatalogFactory = () =>
  makeChange(
    'final-devoicing',
    'fortition',
    0.9,
    'final devoicing (b d g v z > p t k f s / _#)',
    [B, D, G, VC, Z].map((c) => ({ match: c, env: { after: [edge] }, action: { kind: 'set', delta: { voiced: false } } })),
    (state) => [B, D, G, VC, Z].some((c) => hasSegment(state.lexicon, c)),
  );

const wFortition: CatalogFactory = () =>
  makeChange('w-fortition', 'fortition', 0.6, 'fortition of w (w > v everywhere)', [
    { match: WW, env: {}, action: { kind: 'set', delta: { manner: 'fricative' } } },
  ]);

const glideFortition: CatalogFactory = () =>
  makeChange(
    'glide-fortition',
    'fortition',
    0.4,
    'fortition of initial glide (j > dʒ / #_)',
    [{ match: YY, env: { before: [edge] }, action: { kind: 'set', delta: { place: 'postalveolar', manner: 'affricate' } } }],
    (state) => hasSegment(state.lexicon, { type: 'C', manner: 'affricate' }) || hasSegment(state.lexicon, { type: 'C', manner: 'stop', voiced: true }),
  );

const degemination: CatalogFactory = () =>
  makeChange(
    'degemination',
    'deletion',
    0.7,
    'degemination (identical CC > C)',
    ALL_CONSONANT_QUALITIES.map((q) => ({ match: q, env: { before: [seg(q)] }, action: { kind: 'delete' } })),
    (state) => hasAdjacentPair(state.lexicon, sameConsonant),
  );

// ------------------------------------------------------------------ 7-13

const apocope: CatalogFactory = () =>
  makeChange('apocope', 'deletion', 1.6, 'apocope (final unstressed V > ∅ / C_#)', [
    { match: ANY_V, selfStress: 'unstressed', env: { before: [seg(ANY_C)], after: [edge] }, action: { kind: 'delete' } },
  ]);

const syncope: CatalogFactory = () =>
  makeChange('syncope', 'deletion', 0.9, 'syncope (medial unstressed V > ∅ between single Cs)', [
    {
      match: ANY_V,
      selfStress: 'unstressed',
      env: { before: [seg(ANY_V), seg(ANY_C)], after: [seg(ANY_C), seg(ANY_V)] },
      action: { kind: 'delete' },
    },
  ]);

const finalStopLoss: CatalogFactory = () =>
  // The universal word-guard (specs/M2.md application step 3) already
  // refuses any result under 2 segments, which is exactly the "words of
  // >= 3 segments" precondition for a single final-consonant deletion.
  makeChange('final-stop-loss', 'deletion', 1.0, 'loss of word-final stops', [
    { match: { type: 'C', manner: 'stop' }, env: { after: [edge] }, action: { kind: 'delete' } },
  ]);

const hLoss: CatalogFactory = () => makeChange('h-loss', 'deletion', 1.0, 'loss of h in all positions', [{ match: HH, env: {}, action: { kind: 'delete' } }]);

const initialClusterReduction: CatalogFactory = () =>
  makeChange('initial-cluster-reduction', 'deletion', 0.5, 'initial cluster reduction (#CC > #C, keep second)', [
    { match: ANY_C, env: { before: [edge], after: [seg(ANY_C)] }, action: { kind: 'delete' } },
  ]);

const finalNLossWithNasalization: CatalogFactory = () =>
  makeChange('final-n-loss-with-nasalization', 'deletion', 0.6, 'final n loss with compensatory nasalization (Vn > Ṽ / _#)', [
    { match: ANY_V, env: { after: [seg(NAS_N), edge] }, action: { kind: 'set', delta: { nasal: true } } },
    { match: NAS_N, env: { before: [seg({ type: 'V', nasal: true })], after: [edge] }, action: { kind: 'delete' } },
  ]);

const unstressedVowelReduction: CatalogFactory = () =>
  makeChange(
    'unstressed-vowel-reduction',
    'vowelshift',
    0.7,
    'reduction of unstressed non-low vowels to schwa',
    [I, E, O, U, UE, OE].map((q) => ({
      match: q,
      selfStress: 'unstressed',
      env: {},
      action: { kind: 'set', delta: { height: 'mid', backness: 'central', rounded: false, long: false } },
    })),
    (state) => hasSegment(state.lexicon, SCHWA) || vowelQualityKeysInUse(state.lexicon).size >= 5,
  );

// ----------------------------------------------------------------- 14-19

const nasalPlaceAssim: CatalogFactory = () =>
  makeChange('nasal-place-assim', 'assimilation', 0.8, 'nasal place assimilation (n > m / _labial stop; m > n / _alveolar stop)', [
    { match: NAS_N, env: { after: [seg({ type: 'C', place: 'labial', manner: 'stop' })] }, action: { kind: 'set', delta: { place: 'labial' } } },
    { match: NAS_M, env: { after: [seg({ type: 'C', place: 'alveolar', manner: 'stop' })] }, action: { kind: 'set', delta: { place: 'alveolar' } } },
  ]);

const SAFE_VOICED_UNVOICED_PAIRS: SegPattern[] = [P, T, K, F, S]; // voiceless bases with a voiced counterpart in the symbol table
const TRIGGER_MANNERS: Manner[] = ['stop', 'fricative'];

const clusterVoicingAssim: CatalogFactory = () => {
  const subRules: SubRule[] = [];
  for (const voiceless of SAFE_VOICED_UNVOICED_PAIRS) {
    for (const trig of TRIGGER_MANNERS) {
      subRules.push({
        match: voiceless,
        env: { after: [seg({ type: 'C', manner: trig, voiced: true })] },
        action: { kind: 'set', delta: { voiced: true } },
      });
    }
  }
  for (const voiceless of SAFE_VOICED_UNVOICED_PAIRS) {
    const voiced = { ...voiceless, voiced: true };
    for (const trig of TRIGGER_MANNERS) {
      subRules.push({
        match: voiced,
        env: { after: [seg({ type: 'C', manner: trig, voiced: false })] },
        action: { kind: 'set', delta: { voiced: false } },
      });
    }
  }
  return makeChange('cluster-voicing-assim', 'assimilation', 0.6, 'obstruent cluster voicing assimilation (agrees with a following obstruent)', subRules);
};

const PALATAL_VELAR_TRIGGERS: SegPattern[] = [I, E, YY, UE];

const palatalizationVelar: CatalogFactory = () => {
  const subRules: SubRule[] = [];
  for (const trig of PALATAL_VELAR_TRIGGERS) {
    subRules.push({ match: K, env: { after: [seg(trig)] }, action: { kind: 'set', delta: { place: 'postalveolar', manner: 'affricate' } } });
    subRules.push({ match: G, env: { after: [seg(trig)] }, action: { kind: 'set', delta: { place: 'postalveolar', manner: 'affricate' } } });
  }
  return makeChange('palatalization-velar', 'palatalization', 1.0, 'velar palatalization (k g > tʃ dʒ / _{i,e,j,y})', subRules);
};

const PALATAL_ALVEOLAR_TRIGGERS: SegPattern[] = [I, YY];

const palatalizationAlveolar: CatalogFactory = () => {
  const subRules: SubRule[] = [];
  for (const trig of PALATAL_ALVEOLAR_TRIGGERS) {
    subRules.push({ match: T, env: { after: [seg(trig)] }, action: { kind: 'set', delta: { place: 'postalveolar', manner: 'affricate' } } });
    subRules.push({ match: D, env: { after: [seg(trig)] }, action: { kind: 'set', delta: { place: 'postalveolar', manner: 'affricate' } } });
    subRules.push({ match: S, env: { after: [seg(trig)] }, action: { kind: 'set', delta: { place: 'postalveolar' } } });
  }
  return makeChange('palatalization-alveolar', 'palatalization', 0.4, 'alveolar palatalization (t d s > tʃ dʒ ʃ / _{i,j}) (rarer variant)', subRules);
};

const umlaut: CatalogFactory = () => {
  const targets: Array<{ match: SegPattern; delta: Partial<Vowel> }> = [
    { match: A, delta: { height: 'mid', backness: 'front' } },
    { match: O, delta: { backness: 'front' } },
    { match: U, delta: { backness: 'front' } },
  ];
  const triggers: SegPattern[] = [I, YY];
  const subRules: SubRule[] = [];
  for (const { match, delta } of targets) {
    for (const trig of triggers) {
      subRules.push({ match, env: { after: [seg(trig)] }, action: { kind: 'set', delta } });
      subRules.push({ match, env: { after: [seg(ANY_C), seg(trig)] }, action: { kind: 'set', delta } });
    }
  }
  return makeChange(
    'umlaut',
    'vowelshift',
    0.8,
    'umlaut (a o u > e ø y before a following i/j)',
    subRules,
    (state) => hasSegment(state.lexicon, { type: 'V', backness: 'front' }),
  );
};

const totalAssimNt: CatalogFactory = () =>
  makeChange('total-assim-nt', 'assimilation', 0.3, 'total assimilation of nt > tt', [
    { match: NAS_N, env: { after: [seg(T)] }, action: { kind: 'set', delta: { manner: 'stop', voiced: false } } },
  ]);

// ----------------------------------------------------------------- 20-27

const chainRaising: CatalogFactory = () =>
  makeChange('chain-raising', 'vowelshift', 0.9, 'chain raising (o > u, a > o)', [
    { match: O, env: {}, action: { kind: 'set', delta: { height: 'high' } } }, // o > u first, so incoming a > o doesn't re-raise
    { match: A, env: {}, action: { kind: 'set', delta: { height: 'mid', backness: 'back', rounded: true } } },
  ]);

const frontingU: CatalogFactory = () =>
  makeChange('fronting-u', 'vowelshift', 0.5, 'fronting of u (u > y)', [{ match: U, env: {}, action: { kind: 'set', delta: { backness: 'front' } } }]);

const raisingE: CatalogFactory = () =>
  makeChange('raising-e', 'vowelshift', 0.7, 'raising of e (e > i)', [{ match: E, env: {}, action: { kind: 'set', delta: { height: 'high' } } }]);

const frontingA: CatalogFactory = () =>
  makeChange(
    'fronting-a',
    'vowelshift',
    0.6,
    'fronting of a (a > e), umlaut-free systems only',
    [{ match: A, env: {}, action: { kind: 'set', delta: { height: 'mid', backness: 'front' } } }],
    (state) => !state.changeHistory.includes('umlaut'),
  );

const diphthongization: CatalogFactory = () =>
  makeChange(
    'diphthongization',
    'vowelshift',
    0.5,
    'diphthongization of long mid vowels (eː oː > ie uo)',
    [
      { match: { ...E, long: true }, env: {}, action: { kind: 'replace', segments: [vSeg('high', 'front', false), vSeg('mid', 'front', false)] } },
      { match: { ...O, long: true }, env: {}, action: { kind: 'replace', segments: [vSeg('high', 'back', true), vSeg('mid', 'back', true)] } },
    ],
    (state) => hasSegment(state.lexicon, { type: 'V', long: true }),
  );

const monophthongization: CatalogFactory = () =>
  makeChange(
    'monophthongization',
    'vowelshift',
    0.5,
    'monophthongization of diphthongs (ai au > eː oː)',
    [
      { match: A, env: { after: [seg(I)] }, action: { kind: 'set', delta: { height: 'mid', backness: 'front', long: true } } },
      { match: I, env: { before: [seg({ ...E, long: true })] }, action: { kind: 'delete' } },
      { match: A, env: { after: [seg(U)] }, action: { kind: 'set', delta: { height: 'mid', backness: 'back', rounded: true, long: true } } },
      { match: U, env: { before: [seg({ ...O, long: true })] }, action: { kind: 'delete' } },
    ],
    (state) =>
      hasAdjacentPair(state.lexicon, (a, b) => matchPattern(a, A) && matchPattern(b, I)) ||
      hasAdjacentPair(state.lexicon, (a, b) => matchPattern(a, A) && matchPattern(b, U)),
  );

const lengthLoss: CatalogFactory = () =>
  makeChange(
    'length-loss',
    'vowelshift',
    0.15,
    'loss of vowel length contrast',
    [{ match: { type: 'V', long: true }, env: {}, action: { kind: 'set', delta: { long: false } } }],
    (state) => hasSegment(state.lexicon, { type: 'V', long: true }),
  );

const nasalVowelMerger: CatalogFactory = () =>
  makeChange(
    'nasal-vowel-merger',
    'vowelshift',
    0.3,
    'nasal vowel height merger (high nasal vowels lower to mid)',
    [{ match: { type: 'V', nasal: true, height: 'high' }, env: {}, action: { kind: 'set', delta: { height: 'mid' } } }],
    (state) => nasalVowelQualityCount(state.lexicon) >= 2,
  );

// ----------------------------------------------------------------- 28-30

const prothesis: CatalogFactory = () =>
  makeChange(
    'prothesis',
    'epenthesis',
    0.25,
    'prothesis before initial sC clusters (∅ > e / #_sC)',
    [{ match: S, env: { before: [edge], after: [seg(ANY_C)] }, action: { kind: 'insertBefore', segment: vSeg('mid', 'front', false) } }],
    startsWithSC,
  );

const anaptyxis: CatalogFactory = () =>
  makeChange('anaptyxis', 'epenthesis', 0.3, 'anaptyxis breaking up medial consonant clusters (∅ > ə / VC_C)', [
    { match: ANY_C, env: { before: [seg(ANY_V)], after: [seg(ANY_C)] }, action: { kind: 'insertAfter', segment: vSeg('mid', 'central', false) } },
  ]);

const paragoge: CatalogFactory = () =>
  makeChange(
    'paragoge',
    'epenthesis',
    0.15,
    'paragoge after final obstruents (∅ > e / obstruent_#)',
    (['stop', 'fricative', 'affricate'] as Manner[]).map((manner) => ({
      match: { type: 'C', manner },
      env: { after: [edge] },
      action: { kind: 'insertAfter', segment: vSeg('mid', 'front', false) },
    })),
  );

// ----------------------------------------------------------------- 31-38

const rhotacism: CatalogFactory = () =>
  makeChange(
    'rhotacism',
    'other',
    0.35,
    'rhotacism (s z > r / V_V)',
    [S, Z].map((c) => ({
      match: c,
      env: { before: [seg(ANY_V)], after: [seg(ANY_V)] },
      action: { kind: 'set', delta: { place: 'alveolar', manner: 'rhotic', voiced: true } },
    })),
    (state) => hasSegment(state.lexicon, RR),
  );

const debuccalization: CatalogFactory = () =>
  makeChange('debuccalization', 'other', 0.3, 'debuccalization of initial s (s > h / #_)', [
    { match: S, env: { before: [edge] }, action: { kind: 'set', delta: { place: 'glottal', manner: 'fricative' } } },
  ]);

const METATHESIS_QUALITIES: SegPattern[] = [I, E, A, O, U];

const liquidMetathesis: CatalogFactory = () => {
  const subRules: SubRule[] = [];
  for (const q of METATHESIS_QUALITIES) {
    const short = { ...q, long: false };
    // Step 1: copy the vowel's quality onto the r that follows it (still
    // leaves the original vowel in place — this is a scratch step). Gated
    // on the same "onset C before the V" requirement as step 2, so the two
    // steps are atomic: if step 2 can't complete the swap, step 1 must not
    // fire either (otherwise r would simply vanish into a vowel copy).
    subRules.push({
      match: RR,
      env: { before: [seg(ANY_C), seg(short)], after: [seg(ANY_C)] },
      action: { kind: 'replace', segments: [vSegFromQuality(q, false)] },
    });
    // Step 2: the original vowel, now immediately followed by the copy
    // step 1 just planted, becomes r — completing the swap.
    subRules.push({
      match: short,
      env: { before: [seg(ANY_C)], after: [seg(short)] },
      action: { kind: 'replace', segments: [cSeg('alveolar', 'rhotic', true)] },
    });
  }
  return makeChange('liquid-metathesis', 'metathesis', 0.1, 'liquid metathesis in closed syllables (CVrC > CrVC)', subRules);
};

const lVocalization: CatalogFactory = () =>
  makeChange(
    'l-vocalization',
    'lenition',
    0.35,
    'l-vocalization (l > w / _C and _#)',
    [
      { match: LL, env: { after: [seg(ANY_C)] }, action: { kind: 'set', delta: { place: 'labial', manner: 'glide' } } },
      { match: LL, env: { after: [edge] }, action: { kind: 'set', delta: { place: 'labial', manner: 'glide' } } },
    ],
    (state) => hasSegment(state.lexicon, WW),
  );

const grimmBundle: CatalogFactory = () =>
  makeChange(
    'grimm-bundle',
    'other',
    0.03,
    "Grimm's-law-style chain shift (p t k > f s h; b d g > p t k)",
    [
      { match: P, env: {}, action: { kind: 'set', delta: { manner: 'fricative' } } },
      { match: T, env: {}, action: { kind: 'set', delta: { manner: 'fricative' } } },
      { match: K, env: {}, action: { kind: 'set', delta: { place: 'glottal', manner: 'fricative' } } },
      { match: B, env: {}, action: { kind: 'set', delta: { voiced: false } } },
      { match: D, env: {}, action: { kind: 'set', delta: { voiced: false } } },
      { match: G, env: {}, action: { kind: 'set', delta: { voiced: false } } },
    ],
    (state) => !state.changeHistory.includes('grimm-bundle'),
  );

const intervocalicGlideLoss: CatalogFactory = () =>
  makeChange(
    'intervocalic-glide-loss',
    'deletion',
    0.4,
    'loss of intervocalic glides (j w > ∅ / V_V)',
    [YY, WW].map((c) => ({ match: c, env: { before: [seg(ANY_V)], after: [seg(ANY_V)] }, action: { kind: 'delete' } })),
  );

const hiatusResolution: CatalogFactory = () => {
  const subRules: SubRule[] = [];
  for (const q of ALL_VOWEL_QUALITIES) {
    subRules.push({ match: q, env: { after: [seg(q)] }, action: { kind: 'replace', segments: [vSegFromQuality(q, true)] } });
    subRules.push({ match: q, env: { before: [seg({ ...q, long: true })] }, action: { kind: 'delete' } });
  }
  return makeChange(
    'hiatus-resolution',
    'other',
    0.4,
    'resolution of vowel hiatus (identical V.V > single long V)',
    subRules,
    (state) => hasAdjacentPair(state.lexicon, sameVowelQuality),
  );
};

const stressShiftInitial: CatalogFactory = () =>
  makeChange('stress-shift-initial', 'other', 0.15, 'stress shift to the initial syllable', [
    { match: {}, env: {}, action: { kind: 'wordStressToFirstVowel' } },
  ]);

// ------------------------------------------------------------------ export

export const CATALOG: readonly CatalogFactory[] = [
  voicing,
  spirantization,
  finalDevoicing,
  wFortition,
  glideFortition,
  degemination,
  apocope,
  syncope,
  finalStopLoss,
  hLoss,
  initialClusterReduction,
  finalNLossWithNasalization,
  unstressedVowelReduction,
  nasalPlaceAssim,
  clusterVoicingAssim,
  palatalizationVelar,
  palatalizationAlveolar,
  umlaut,
  totalAssimNt,
  chainRaising,
  frontingU,
  raisingE,
  frontingA,
  diphthongization,
  monophthongization,
  lengthLoss,
  nasalVowelMerger,
  prothesis,
  anaptyxis,
  paragoge,
  rhotacism,
  debuccalization,
  liquidMetathesis,
  lVocalization,
  grimmBundle,
  intervocalicGlideLoss,
  hiatusResolution,
  stressShiftInitial,
];
