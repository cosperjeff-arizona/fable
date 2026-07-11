// Rule representation over features (specs/M2.md's "Rule representation").
//
// A SoundChange is a bundle of SubRules, each a static { match, env, action }
// triple. Matching is purely feature-based — no regex/string matching — so
// the catalog composes correctly over segments the proto-language never
// generated (see DESIGN.md's "key upgrade" note).

import type { Consonant, Segment, Vowel } from '../phonology.js';
import { isConsonant, isVowel, segKey } from '../phonology.js';
import type { Lexicon } from '../lexicon.js';

/** Matches a segment iff every feature named in the pattern equals the
 * segment's value for that feature. An empty pattern (or `{ type: 'C' }`
 * alone) matches every consonant/vowel respectively. */
export type SegPattern = Partial<Omit<Consonant, 'type'>> & Partial<Omit<Vowel, 'type'>> & { type?: 'C' | 'V' };

export type ContextAtom =
  | { kind: 'boundary' } // word edge (#)
  | { kind: 'seg'; pattern: SegPattern }
  | { kind: 'stressedV' }
  | { kind: 'unstressedV' };

export type Action =
  | { kind: 'set'; delta: Partial<Consonant> | Partial<Vowel> } // feature rewrite; never changes `type`
  | { kind: 'delete' }
  | { kind: 'replace'; segments: Segment[] } // segment-count-changing rewrite (diphthongization, mergers…)
  | { kind: 'insertBefore'; segment: Segment }
  | { kind: 'insertAfter'; segment: Segment }
  /**
   * Spec-silent extension: catalog entry 38 (stress-shift-initial) has "no
   * segmental effect" — it only relocates stress — but every other Action
   * variant is anchored to a matched *segment position*. This variant is
   * whole-word: it ignores `match`/`env` entirely and moves stress directly
   * to the word's first vowel. Kept in the Action union (rather than a
   * separate mechanism) so it stays a plain, JSON-serializable subRule like
   * everything else.
   */
  | { kind: 'wordStressToFirstVowel' };

export type SubRule = {
  match: SegPattern;
  env: { before?: ContextAtom[]; after?: ContextAtom[] };
  /**
   * Spec-silent extension: specs/M2.md's ContextAtom (stressedV/unstressedV)
   * only describes *neighboring* segments, but several catalog entries
   * (apocope, syncope, unstressed-vowel-reduction) are conditioned on the
   * stress of the matched segment itself, which no combination of
   * before/after atoms can express. `selfStress` fills that gap; it's a
   * plain string so subRules stay JSON-serializable.
   */
  selfStress?: 'stressed' | 'unstressed';
  action: Action;
};

export type ChangeFamily =
  | 'lenition'
  | 'fortition'
  | 'deletion'
  | 'assimilation'
  | 'vowelshift'
  | 'palatalization'
  | 'epenthesis'
  | 'metathesis'
  | 'other';

export type SoundChange = {
  id: string;
  family: ChangeFamily;
  weight: number;
  describe(): string;
  subRules: SubRule[]; // applied in order; JSON-serializable (no functions)
  applicable(state: LangState): boolean;
};

/** Everything a catalog entry's `applicable()` (or sample.ts's dry-run
 * rejection) needs to condition on. `changeHistory` is the *full* list of
 * change ids applied along this branch's ancestor path (oldest to newest),
 * not just a rolling window — grimm-bundle's "once per family" precondition
 * needs the whole path, while sample.ts derives the "last 4" window from it
 * with `recentChangeIds`. */
export type LangState = {
  lexicon: Lexicon;
  changeHistory: readonly string[];
};

export function recentChangeIds(state: LangState, n = 4): string[] {
  return state.changeHistory.slice(Math.max(0, state.changeHistory.length - n));
}

/** True iff every feature named in `pattern` equals `seg`'s value for it. */
export function matchPattern(seg: Segment, pattern: SegPattern): boolean {
  if (pattern.type && seg.type !== pattern.type) return false;
  for (const key of Object.keys(pattern) as (keyof SegPattern)[]) {
    if (key === 'type') continue;
    const want = pattern[key];
    if (want === undefined) continue;
    if ((seg as unknown as Record<string, unknown>)[key] !== want) return false;
  }
  return true;
}

function* allWords(lexicon: Lexicon) {
  for (const lexeme of lexicon.lexemes.values()) yield lexeme.word;
}

function* allSegments(lexicon: Lexicon): Iterable<Segment> {
  for (const word of allWords(lexicon)) for (const seg of word.segments) yield seg;
  for (const affix of lexicon.affixes) for (const seg of affix.form) yield seg;
}

/** Segment keys of every consonant currently attested anywhere in the
 * lexicon (roots, derived/compound words, and affix forms). */
export function consonantKeysInUse(lexicon: Lexicon): Set<string> {
  const keys = new Set<string>();
  for (const seg of allSegments(lexicon)) if (isConsonant(seg)) keys.add(segKey(seg));
  return keys;
}

const vowelQualityKey = (v: Vowel): string => `${v.height}:${v.backness}:${v.rounded}:${v.nasal}`;

/** Distinct vowel *qualities* (height/backness/rounded/nasal, ignoring
 * length) attested in the lexicon. */
export function vowelQualityKeysInUse(lexicon: Lexicon): Set<string> {
  const keys = new Set<string>();
  for (const seg of allSegments(lexicon)) if (isVowel(seg)) keys.add(vowelQualityKey(seg));
  return keys;
}

/** True iff any segment anywhere in the lexicon matches `pattern`. */
export function hasSegment(lexicon: Lexicon, pattern: SegPattern): boolean {
  for (const seg of allSegments(lexicon)) if (matchPattern(seg, pattern)) return true;
  return false;
}

/** True iff any word has two adjacent segments both matching `pattern`,
 * with `sameQuality` true between them (used for "identical C/V" style
 * preconditions: geminates, hiatus). */
export function hasAdjacentPair(
  lexicon: Lexicon,
  isMatch: (a: Segment, b: Segment) => boolean,
): boolean {
  for (const word of allWords(lexicon)) {
    for (let i = 0; i + 1 < word.segments.length; i++) {
      if (isMatch(word.segments[i]!, word.segments[i + 1]!)) return true;
    }
  }
  return false;
}

/** Number of distinct nasal vowel *qualities* (height/backness/rounded)
 * attested in the lexicon — used by nasal-vowel-merger's precondition. */
export function nasalVowelQualityCount(lexicon: Lexicon): number {
  const keys = new Set<string>();
  for (const seg of allSegments(lexicon)) {
    if (isVowel(seg) && seg.nasal) keys.add(`${seg.height}:${seg.backness}:${seg.rounded}`);
  }
  return keys.size;
}
