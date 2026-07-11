// Application semantics (specs/M2.md's "Application semantics").
//
// applyChange(word, change) is a pure function: for each subRule in order,
// find all match positions against the *pre-subRule* word (simultaneous —
// no self-feeding within a subRule), then apply actions right-to-left so
// indices stay valid. Stress is remapped through insertions/deletions.
// A word guard undoes the whole change if the result would be degenerate
// (< 2 segments, or no vowel). Returns the same reference if nothing
// changed, for cheap trace detection.

import { type Segment, type Word, isVowel } from '../phonology.js';
import type { Lexicon } from '../lexicon.js';
import { type Action, type ContextAtom, type SoundChange, type SubRule, matchPattern } from './rules.js';

// ------------------------------------------------------------ environment

function matchAtomAt(segments: readonly Segment[], stress: number, idx: number, atom: ContextAtom): boolean {
  const seg = segments[idx];
  if (!seg) return false;
  if (atom.kind === 'seg') return matchPattern(seg, atom.pattern);
  if (atom.kind === 'stressedV') return isVowel(seg) && idx === stress;
  if (atom.kind === 'unstressedV') return isVowel(seg) && idx !== stress;
  return false; // 'boundary' is handled by the caller, never reaches here
}

/** `atoms` reads left-to-right ending immediately before `pos`; the last
 * element is the segment closest to `pos` (i.e. at pos - 1). */
function matchBefore(segments: readonly Segment[], stress: number, pos: number, atoms: readonly ContextAtom[]): boolean {
  let idx = pos - 1;
  for (let k = atoms.length - 1; k >= 0; k--) {
    const atom = atoms[k]!;
    if (atom.kind === 'boundary') {
      if (idx !== -1) return false;
      continue;
    }
    if (idx < 0) return false;
    if (!matchAtomAt(segments, stress, idx, atom)) return false;
    idx--;
  }
  return true;
}

/** `atoms` reads left-to-right starting immediately after `pos`; the first
 * element is the segment closest to `pos` (i.e. at pos + 1). */
function matchAfter(segments: readonly Segment[], stress: number, pos: number, atoms: readonly ContextAtom[]): boolean {
  let idx = pos + 1;
  for (const atom of atoms) {
    if (atom.kind === 'boundary') {
      if (idx !== segments.length) return false;
      continue;
    }
    if (idx >= segments.length) return false;
    if (!matchAtomAt(segments, stress, idx, atom)) return false;
    idx++;
  }
  return true;
}

function matchSubRuleAt(segments: readonly Segment[], stress: number, pos: number, subRule: SubRule): boolean {
  const seg = segments[pos]!;
  if (!matchPattern(seg, subRule.match)) return false;
  if (subRule.selfStress === 'stressed' && pos !== stress) return false;
  if (subRule.selfStress === 'unstressed' && pos === stress) return false;
  if (!matchBefore(segments, stress, pos, subRule.env.before ?? [])) return false;
  if (!matchAfter(segments, stress, pos, subRule.env.after ?? [])) return false;
  return true;
}

function findMatches(segments: readonly Segment[], stress: number, subRule: SubRule): number[] {
  const positions: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (matchSubRuleAt(segments, stress, i, subRule)) positions.push(i);
  }
  return positions;
}

// ------------------------------------------------------------------ action

/** Apply `action` at `pos` in `segs` (mutated in place), returning the
 * updated stress index. `pos` must still be valid in `segs` — callers must
 * process match positions right-to-left within a subRule so earlier
 * (smaller) positions are untouched by later (larger) edits. */
function applyActionAt(segs: Segment[], stress: number, pos: number, action: Action): number {
  switch (action.kind) {
    case 'set': {
      segs[pos] = { ...segs[pos]!, ...action.delta } as Segment;
      return stress;
    }
    case 'delete': {
      const wasStress = pos === stress;
      segs.splice(pos, 1);
      if (wasStress) return nearestVowel(segs, pos);
      return pos < stress ? stress - 1 : stress;
    }
    case 'replace': {
      const wasStress = pos === stress;
      const delta = action.segments.length - 1;
      segs.splice(pos, 1, ...action.segments);
      if (wasStress) {
        const vIdxInReplacement = action.segments.findIndex(isVowel);
        if (vIdxInReplacement >= 0) return pos + vIdxInReplacement;
        return nearestVowel(segs, pos);
      }
      return pos < stress ? stress + delta : stress;
    }
    case 'insertBefore':
      return spliceInsert(segs, stress, pos, action.segment);
    case 'insertAfter':
      return spliceInsert(segs, stress, pos + 1, action.segment);
    case 'wordStressToFirstVowel':
      // Handled before matching in applySubRule; unreachable here.
      return stress;
  }
}

function spliceInsert(segs: Segment[], stress: number, insIdx: number, segment: Segment): number {
  segs.splice(insIdx, 0, segment);
  return stress >= insIdx ? stress + 1 : stress;
}

/** After deleting/replacing the segment that carried stress, move stress to
 * the nearest surviving vowel: search left from `pos - 1`, else right from
 * `pos` (specs/M2.md's "Application semantics" step 2). `pos` is the index
 * in the *already-mutated* array where the deleted segment used to sit. */
function nearestVowel(segs: readonly Segment[], pos: number): number {
  for (let k = pos - 1; k >= 0; k--) if (isVowel(segs[k]!)) return k;
  for (let k = pos; k < segs.length; k++) if (isVowel(segs[k]!)) return k;
  return 0; // no vowel left anywhere; the word-guard in applySubRules will revert
}

// -------------------------------------------------------------- sub-rules

function applySubRule(segments: Segment[], stress: number, subRule: SubRule): { segments: Segment[]; stress: number; changed: boolean } {
  if (subRule.action.kind === 'wordStressToFirstVowel') {
    const firstVowel = segments.findIndex(isVowel);
    if (firstVowel < 0 || firstVowel === stress) return { segments, stress, changed: false };
    return { segments, stress: firstVowel, changed: true };
  }
  const matches = findMatches(segments, stress, subRule);
  if (matches.length === 0) return { segments, stress, changed: false };
  const segs = segments.slice();
  let st = stress;
  for (let k = matches.length - 1; k >= 0; k--) {
    st = applyActionAt(segs, st, matches[k]!, subRule.action);
  }
  return { segments: segs, stress: st, changed: true };
}

/** Core engine: run `subRules` over `word.segments`/`word.stress` in order,
 * then apply the word guard. Operates on a bare subRules array (rather than
 * a full SoundChange) so catalog `applicable()` checks and dry-run
 * rejection can probe "would this rule change anything" without
 * constructing a throwaway SoundChange wrapper. */
export function applySubRules(word: Word, subRules: readonly SubRule[]): Word {
  let segments = word.segments;
  let stress = word.stress;
  let changed = false;
  for (const subRule of subRules) {
    const result = applySubRule(segments, stress, subRule);
    if (result.changed) {
      segments = result.segments;
      stress = result.stress;
      changed = true;
    }
  }
  if (!changed) return word;
  if (segments.length < 2 || !segments.some(isVowel)) return word; // word guard: revert entirely
  return { segments, stress };
}

/** Pure function; returns the same `word` reference if nothing changed. */
export function applyChange(word: Word, change: SoundChange): Word {
  return applySubRules(word, change.subRules);
}

/** True iff applying `subRules` to `word` would change it — used by catalog
 * `applicable()` predicates that need "does the target even occur here". */
export function wouldChange(word: Word, subRules: readonly SubRule[]): boolean {
  return applySubRules(word, subRules) !== word;
}

/** True iff `subRules` would change at least one lexeme's citation form. */
export function anyLexemeAffected(subRules: readonly SubRule[], lexicon: Lexicon): boolean {
  for (const lexeme of lexicon.lexemes.values()) {
    if (wouldChange(lexeme.word, subRules)) return true;
  }
  return false;
}

export type EvolveStep = { form: Word; changeId: string };

/**
 * Replay `changes` over `word` in order, recording only steps that altered
 * the form. Must be the exact code path the simulation used, so traces
 * reproduce exactly (specs/M2.md).
 */
export function evolve(word: Word, changes: readonly SoundChange[]): { form: Word; steps: EvolveStep[] } {
  const steps: EvolveStep[] = [];
  let cur = word;
  for (const change of changes) {
    const next = applyChange(cur, change);
    if (next !== cur) {
      steps.push({ form: next, changeId: change.id });
      cur = next;
    }
  }
  return { form: cur, steps };
}

// Re-exported for tests that want to probe environment matching directly
// without going through a full SoundChange.
export { findMatches as _findMatches };
