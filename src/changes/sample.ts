// Sampling & plausibility (specs/M2.md's "Sampling & plausibility").
//
// sampleChange is the mechanism that turns "random rules" into "plausible
// history": it filters the catalog by applicability and recency, weights by
// family (deletion-heavy runs get throttled), and dry-run rejects any
// candidate that would cause a catastrophic merger or gut the inventory.

import { isVowel, segKey, wordKey } from '../phonology.js';
import { Stream } from '../prng.js';
import { applySubRules } from './apply.js';
import { CATALOG } from './catalog.js';
import { type ChangeFamily, type LangState, type SoundChange, recentChangeIds } from './rules.js';

const MAX_DRY_RUN_ATTEMPTS = 8;
const HOMOPHONE_INCREASE_FRACTION = 0.06;
const MIN_VOWEL_QUALITIES = 3;
const MIN_CONSONANTS = 8;
const RECENT_WINDOW = 4;
const DELETION_STREAK_PENALTY = 0.5;

// Instantiating a factory to read its static id/family is safe: none of our
// factories consume stream entropy to decide their id or family (only, in
// principle, their subRules' fine detail), so probing with a throwaway
// Stream is stable across calls and doesn't perturb any branch's real
// stream consumption.
const FAMILY_BY_ID: ReadonlyMap<string, ChangeFamily> = new Map(
  CATALOG.map((factory) => {
    const c = factory(new Stream(0));
    return [c.id, c.family] as const;
  }),
);

function countHomophonePairs(keys: readonly string[]): number {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  let pairs = 0;
  for (const c of counts.values()) if (c > 1) pairs += (c * (c - 1)) / 2;
  return pairs;
}

/** Dry-run `change` against every lexeme's citation form. Rejects if the
 * homophone-pair count rises by more than 6% of lexicon size, or if the
 * resulting inventory would have fewer than 3 vowel qualities or 8
 * consonants — the guardrails that keep sampled histories from
 * degenerating into catastrophic mergers. */
export function dryRunRejects(change: SoundChange, state: LangState): boolean {
  const lexemes = [...state.lexicon.lexemes.values()];
  if (lexemes.length === 0) return false;

  const beforeKeys = lexemes.map((l) => wordKey(l.word));
  const afterWords = lexemes.map((l) => applySubRules(l.word, change.subRules));
  const afterKeys = afterWords.map(wordKey);

  const beforePairs = countHomophonePairs(beforeKeys);
  const afterPairs = countHomophonePairs(afterKeys);
  if (afterPairs - beforePairs > HOMOPHONE_INCREASE_FRACTION * lexemes.length) return true;

  const vowelQualities = new Set<string>();
  const consonants = new Set<string>();
  for (const word of afterWords) {
    for (const s of word.segments) {
      if (isVowel(s)) vowelQualities.add(`${s.height}:${s.backness}:${s.rounded}:${s.nasal}`);
      else consonants.add(segKey(s));
    }
  }
  if (vowelQualities.size < MIN_VOWEL_QUALITIES) return true;
  if (consonants.size < MIN_CONSONANTS) return true;
  return false;
}

function effectiveWeight(change: SoundChange, lastTwoWereDeletions: boolean): number {
  if (change.family === 'deletion' && lastTwoWereDeletions) return change.weight * DELETION_STREAK_PENALTY;
  return change.weight;
}

/**
 * Sample one applicable, dry-run-passing SoundChange from the catalog, or
 * `null` if none survives 8 attempts (a "quiet century" — specs/M2.md).
 */
export function sampleChange(state: LangState, stream: Stream): SoundChange | null {
  const recent = new Set(recentChangeIds(state, RECENT_WINDOW));
  const lastTwo = state.changeHistory.slice(-2);
  const lastTwoWereDeletions = lastTwo.length === 2 && lastTwo.every((id) => FAMILY_BY_ID.get(id) === 'deletion');

  let candidates = CATALOG.map((factory) => factory(stream)).filter((c) => c.applicable(state) && !recent.has(c.id));

  for (let attempt = 0; attempt < MAX_DRY_RUN_ATTEMPTS && candidates.length > 0; attempt++) {
    const weighted = candidates.map((c) => [c, effectiveWeight(c, lastTwoWereDeletions)] as const);
    const picked = stream.weightedPick(weighted);
    candidates = candidates.filter((c) => c !== picked);
    if (!dryRunRejects(picked, state)) return picked;
  }
  return null;
}
