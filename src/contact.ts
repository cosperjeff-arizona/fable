// Geography, borrowing, and loanword adaptation (specs/M6.md).
//
// Two pieces:
//  1. A deterministic, zero-randomness geography: every branch owns a
//     sub-interval of [0, 1], split in half at each population split. Two
//     living branches are "adjacent" iff their intervals share an endpoint.
//     This is purely a function of tree *shape*, so it costs nothing and
//     never touches any stream.
//  2. Per-century borrowing between adjacent living branches, drawing all
//     randomness from a dedicated `contact:<idA>|<idB>` pair stream (ids
//     sorted — see src/prng.ts's `Streams.contact`), so enabling/disabling
//     contact, or any other branch's activity, never perturbs a given
//     pair's own draw sequence. Unlike src/drift.ts's drift/taboo sampling,
//     a borrowing DOES mutate the destination branch's `workingLexemes` (not
//     just `semanticLexemes`) — specs/M6.md's "honest note": loans change
//     the phonological ecology sound-change sampling conditions on, so
//     enabling contact can legitimately alter a branch's later sound-change
//     sequence. Byte-identical output is only guaranteed with contact
//     disabled (`--no-contact` / library default `contactEnabled: false`).

import type { Stream } from './prng.js';
import {
  type Consonant,
  type Segment,
  type Vowel,
  type Word,
  isConsonant,
  segKey,
  symbolFor,
} from './phonology.js';
import type { Lexeme } from './lexicon.js';
import { CONCEPTS, type Domain } from './concepts.js';
import { DRIFT_EDGES, type DriftEvent, type LexemeReassignment } from './drift.js';
import { romanize } from './romanize.js';

// ------------------------------------------------------------- geography

export type Interval = { start: number; end: number };

export function rootInterval(): Interval {
  return { start: 0, end: 1 };
}

/** Halve `parent`'s interval: left half for the `.0` child, right half for
 * the `.1` child (specs/M6.md). Pure arithmetic on dyadic rationals — every
 * interval endpoint a real simulation ever produces is exactly representable
 * in a double, so `===` endpoint comparisons in `intervalsAdjacent` are
 * exact, never approximate. */
export function splitInterval(parent: Interval): [Interval, Interval] {
  const mid = (parent.start + parent.end) / 2;
  return [
    { start: parent.start, end: mid },
    { start: mid, end: parent.end },
  ];
}

/** Two intervals are adjacent iff they share an endpoint. */
export function intervalsAdjacent(a: Interval, b: Interval): boolean {
  return a.end === b.start || b.end === a.start;
}

export type LivingBranchGeo = { id: string; interval: Interval };

/**
 * Every adjacent pair among `living`, in deterministic order: sorted by
 * interval position (start, then the partner's start) — specs/M6.md's
 * "pairs enumerated in deterministic order: by interval position". Because
 * every currently-living branch's interval is disjoint from every other's
 * and together they exactly tile the root's [0, 1] span (a split's two
 * children exactly cover the parent's span), this reduces in practice to
 * consecutive pairs in start-sorted order — but the check itself doesn't
 * assume that; it directly tests every pair for a shared endpoint.
 */
export function adjacentPairs<T extends LivingBranchGeo>(living: readonly T[]): [T, T][] {
  const sorted = [...living].sort((a, b) => a.interval.start - b.interval.start);
  const pairs: [T, T][] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (intervalsAdjacent(sorted[i]!.interval, sorted[j]!.interval)) pairs.push([sorted[i]!, sorted[j]!]);
    }
  }
  return pairs;
}

// --------------------------------------------------------- inventory-in-use

export type InUseInventory = { consonants: Consonant[]; vowels: Vowel[] };

/** Every distinct segment (by feature bundle) appearing anywhere in
 * `lexemes`' current forms, consonants and vowels separately, in stable
 * first-seen order (specs/M6.md's "segments in use across its working
 * lexicon", and the tie-break's "catalog order" — see `nearestSegment`). */
export function inventoryInUse(lexemes: ReadonlyMap<string, Lexeme>): InUseInventory {
  const consonants: Consonant[] = [];
  const vowels: Vowel[] = [];
  const seen = new Set<string>();
  for (const lexeme of lexemes.values()) {
    for (const seg of lexeme.word.segments) {
      const key = segKey(seg);
      if (seen.has(key)) continue;
      seen.add(key);
      if (isConsonant(seg)) consonants.push(seg);
      else vowels.push(seg);
    }
  }
  return { consonants, vowels };
}

// ------------------------------------------------------------- adaptation

function consonantDistance(a: Consonant, b: Consonant): number {
  return (a.place !== b.place ? 2 : 0) + (a.manner !== b.manner ? 3 : 0) + (a.voiced !== b.voiced ? 1 : 0);
}

function vowelDistance(a: Vowel, b: Vowel): number {
  return (
    (a.height !== b.height ? 2 : 0) +
    (a.backness !== b.backness ? 2 : 0) +
    (a.rounded !== b.rounded ? 1 : 0) +
    (a.nasal !== b.nasal ? 3 : 0) +
    (a.long !== b.long ? 1 : 0)
  );
}

/** Nearest segment to `seg` among `pool` (minimum feature distance; ties
 * broken by `pool`'s own order — specs/M6.md's "ties broken by catalog
 * order", where the "catalog" is the borrower's in-use inventory itself, in
 * the stable first-seen order `inventoryInUse` built it in). A segment
 * identical to `seg` always wins outright (distance 0 is the global
 * minimum) — specs/M6.md's "a perfect match keeps the segment". */
function nearestSegment<S extends Segment>(seg: S, pool: readonly S[], distance: (a: S, b: S) => number): S {
  if (pool.length === 0) throw new Error('contact: borrower has no segments of this type in use');
  let best = pool[0]!;
  let bestDistance = distance(seg, best);
  for (let i = 1; i < pool.length; i++) {
    const candidate = pool[i]!;
    const d = distance(seg, candidate);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

export type Substitution = { from: Segment; to: Segment };
export type Adaptation = { word: Word; substitutions: Substitution[] };

/** Map every segment of `source` to the nearest segment in `borrowerInUse`
 * (specs/M6.md's "Adaptation"). Segment count and stress index are
 * preserved 1:1 — adaptation never inserts/deletes segments, only
 * substitutes phonemes the borrower doesn't have for ones it does. */
export function adaptWord(source: Word, borrowerInUse: InUseInventory): Adaptation {
  const substitutions: Substitution[] = [];
  const segments = source.segments.map((seg): Segment => {
    const mapped: Segment = isConsonant(seg)
      ? nearestSegment(seg, borrowerInUse.consonants, consonantDistance)
      : nearestSegment(seg, borrowerInUse.vowels, vowelDistance);
    if (segKey(mapped) !== segKey(seg)) substitutions.push({ from: seg, to: mapped });
    return mapped;
  });
  return { word: { segments, stress: source.stress }, substitutions };
}

/** Human-readable summary of what adaptation changed, e.g. "adapted: z > s,
 * a > e" or "no adaptation needed" when the source's segments were all
 * already in the borrower's inventory-in-use. */
export function describeAdaptation(substitutions: readonly Substitution[]): string {
  if (substitutions.length === 0) return 'no adaptation needed';
  return 'adapted: ' + substitutions.map((s) => `${symbolFor(s.from)} > ${symbolFor(s.to)}`).join(', ');
}

// --------------------------------------------------------- concept choice

/** specs/M6.md's "weighted by domain" table: wanderwort-prone domains
 * (society/power, artifacts/tools) are 4x as likely to be borrowed;
 * plants/food and animals 2x; body and kinship (the most resistant
 * vocabulary cross-linguistically) 0.5x; everything else 1x. */
const DOMAIN_WEIGHT: Record<Domain, number> = {
  'society/power': 4,
  'artifacts/tools': 4,
  'plants/food': 2,
  animals: 2,
  body: 0.5,
  kinship: 0.5,
  nature: 1,
  actions: 1,
  qualities: 1,
  abstract: 1,
};

/** Pick a concept to borrow, weighted by domain, from among `expressible`
 * (the source branch's currently expressible concepts). Draws exactly one
 * `stream.weightedPick` in CONCEPTS' fixed order, so the outcome is a pure
 * function of the pair stream's position. */
export function pickBorrowedConcept(stream: Stream, expressible: ReadonlySet<string>): string {
  const candidates = CONCEPTS.filter((c) => expressible.has(c.id)).map((c) => [c.id, DOMAIN_WEIGHT[c.domain]] as const);
  if (candidates.length === 0) throw new Error('contact: source branch has no expressible concepts to borrow from');
  return stream.weightedPick(candidates);
}

// ------------------------------------------------------------ borrow step

export type BorrowEvent = {
  kind: 'borrow';
  century: number;
  concept: string;
  fromBranchId: string;
  sourceRomanized: string;
  adaptedRomanized: string;
  note: string;
};

export type ContactConfig = { borrowChance: number };
export const DEFAULT_CONTACT_CONFIG: ContactConfig = { borrowChance: 0.04 };

/** Synthetic lexeme-map key for a native word retained purely as a doublet
 * (no drift edge existed to shift it into another concept's slot) —
 * specs/M6.md's "it stays in the working lexicon... with a sense note
 * ('archaic/register variant')". Never a real CONCEPTS id, so it's inert to
 * everything that iterates CONCEPTS (dict rendering, borrowing candidate
 * selection, drift's own graph) and only ever surfaces through a
 * `LexemeReassignment`/`doublets()` query, exactly like other reassignment-
 * only state (specs/M5.md precedent). */
export function archaicSlot(concept: string): string {
  return `${concept}~archaic`;
}

export type BranchLexemeState = {
  id: string;
  workingLexemes: Map<string, Lexeme>;
  semanticLexemes: Map<string, Lexeme>;
};

export type BorrowStepResult = {
  destId: string;
  events: Array<BorrowEvent | DriftEvent>;
  reassignments: LexemeReassignment[];
  workingLexemes: Map<string, Lexeme>;
  semanticLexemes: Map<string, Lexeme>;
};

/**
 * Run one century's borrowing roll for one adjacent pair of living branches
 * (specs/M6.md's "Borrowing events"). `a`/`b` should be passed in the same
 * sorted-by-id order the caller used to derive `stream` (a's id < b's id),
 * matching the pair stream's own `contact:<idA>|<idB>` naming — but this
 * function itself is direction-agnostic; it draws which one lends from
 * `stream` directly. Returns `null` on a "no borrowing this century" roll
 * (the chance draw is still consumed, so a pair's stream position never
 * depends on whether earlier centuries' rolls succeeded).
 */
export function borrowStep(
  century: number,
  a: BranchLexemeState,
  b: BranchLexemeState,
  stream: Stream,
  config: ContactConfig,
): BorrowStepResult | null {
  if (!stream.chance(config.borrowChance)) return null;

  const aIsSource = stream.chance(0.5);
  const source = aIsSource ? a : b;
  const dest = aIsSource ? b : a;

  const concept = pickBorrowedConcept(stream, new Set(source.semanticLexemes.keys()));
  const sourceWord = source.semanticLexemes.get(concept)!.word;

  const borrowerInUse = inventoryInUse(dest.semanticLexemes);
  const { word: adaptedWord, substitutions } = adaptWord(sourceWord, borrowerInUse);
  const adaptationNote = describeAdaptation(substitutions);

  const workingLexemes = new Map(dest.workingLexemes);
  const semanticLexemes = new Map(dest.semanticLexemes);
  const reassignments: LexemeReassignment[] = [];
  const events: Array<BorrowEvent | DriftEvent> = [];

  // The doublet's native line: whatever currently fills `concept` in the
  // destination, captured before the loan overwrites that slot.
  const nativeLexeme = dest.semanticLexemes.get(concept)!;

  const loanLexeme: Lexeme = { concept, word: adaptedWord, origin: 'root' };
  workingLexemes.set(concept, loanLexeme);
  semanticLexemes.set(concept, loanLexeme);
  reassignments.push({
    century,
    concept,
    word: { segments: adaptedWord.segments, stress: adaptedWord.stress },
    cause: 'borrow',
    fromBranchId: source.id,
    sourceRomanized: romanize(sourceWord),
    adaptationNote,
  });
  events.push({
    kind: 'borrow',
    century,
    concept,
    fromBranchId: source.id,
    sourceRomanized: romanize(sourceWord),
    adaptedRomanized: romanize(adaptedWord),
    note: adaptationNote,
  });

  // specs/M6.md's "Doublets": the displaced native word is retained, either
  // shifted along an outgoing drift edge (reusing M5's shift machinery — the
  // target slot's word is simply overwritten, same as a normal drift shift)
  // or, if no edge exists, parked in a synthetic archaic slot that still
  // evolves with the branch.
  const outgoingEdges = DRIFT_EDGES.filter((e) => e.from === concept);
  const displacedTo = outgoingEdges.length > 0 ? stream.weightedPick(outgoingEdges.map((e) => [e.to, e.w] as const)) : archaicSlot(concept);

  const displacedLexeme: Lexeme = { ...nativeLexeme, concept: displacedTo };
  workingLexemes.set(displacedTo, displacedLexeme);
  semanticLexemes.set(displacedTo, displacedLexeme);
  reassignments.push({
    century,
    concept: displacedTo,
    word: { segments: nativeLexeme.word.segments, stress: nativeLexeme.word.stress },
    cause: 'loan-displacement',
    sourceConcept: concept,
  });
  if (outgoingEdges.length > 0) {
    events.push({ kind: 'shift', century, from: concept, to: displacedTo, note: 'displaced by loan' });
  }

  return { destId: dest.id, events, reassignments, workingLexemes, semanticLexemes };
}
