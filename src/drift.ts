// Semantic drift, taboo replacement, and coinage (specs/M5.md).
//
// Sound change alone diverges *forms*; this module diverges *meanings*. Each
// century, a branch may (a) drift a word's sense along a curated concept
// graph, gapping the old concept and refilling it by coinage; (b) extend a
// word to colexify a second sense, with no gap; or (c) replace a dangerous
// or numinous concept's word outright with a euphemistic compound (taboo).
//
// The crucial property (specs/M5.md's "erosion property", acceptance
// criterion 4) is that coined/reassigned words are built from the branch's
// *current, already-evolved* forms at the moment of coinage, then keep
// eroding through every later sound change like any other word — never
// rebuilt from proto roots at query time. See src/history.ts's per-century
// loop (where reassignments are recorded into the branch's working lexicon,
// exactly as sound changes are) and src/query.ts (which replays sound
// changes forward from a reassignment's stored form, never backward from
// the proto root, once a reassignment exists).

import type { Stream } from './prng.js';
import type { Inventory, Segment, Word } from './phonology.js';
import { type Affix, type Lexeme, affixDerivedWord, compoundWord } from './lexicon.js';
import { CONCEPTS, type Domain } from './concepts.js';

// --------------------------------------------------------------- event model

/** specs/M5.md's "Event model". Joins src/history.ts's `ChangeEvent` union
 * (alongside the existing sound-change event) as the branch event log. */
export type DriftEvent =
  | { kind: 'shift'; century: number; from: string; to: string; note: string }
  | { kind: 'extend'; century: number; from: string; to: string; note: string }
  | { kind: 'taboo'; century: number; concept: string; note: string };

/**
 * The record of one concept "cell" in a branch's working lexicon being
 * (re)assigned to a freshly-built form, rather than continuing to inherit
 * its own proto root. `word` is the resolved form *at `century`*, before any
 * later sound change — the base that src/query.ts replays forward from.
 * Spec-silent addition (specs/M4.md's "Extend the DerivedLeaf entry with
 * optional semantic-note fields as needed" + M5's "{ coinedAt, parts }"):
 * this is what makes the erosion property queryable without re-simulating.
 */
export type LexemeReassignment = {
  century: number;
  concept: string;
  word: { segments: Segment[]; stress: number };
  /** specs/M6.md adds two causes: 'borrow' (this concept's slot was filled
   * by an adapted loanword) and 'loan-displacement' (this slot — either
   * another real concept reached via a drift edge, or a synthetic
   * `<concept>~archaic` slot from src/contact.ts's `archaicSlot` — holds the
   * native word a borrowing displaced). */
  cause: 'shift-target' | 'extend-target' | 'coinage' | 'taboo-coinage' | 'borrow' | 'loan-displacement';
  /** For shift-target/extend-target: the concept whose word this came from.
   * For loan-displacement: the concept the loan displaced this word from. */
  sourceConcept?: string;
  /** For coinage/taboo-coinage: the concept id(s) compounded/derived from. */
  parts?: string[];
  origin?: 'compound' | 'derived';
  /** For 'borrow' only: the lending branch's id, the source form's
   * romanization at borrowing time, and a human-readable summary of the
   * segment substitutions adaptation made (or "no adaptation needed"). */
  fromBranchId?: string;
  sourceRomanized?: string;
  adaptationNote?: string;
};

// ----------------------------------------------------------------- the graph

type DriftEdge = { from: string; to: string; w: number };

/** Bidirectional pairs expand to two directed edges; "(one-way)" pairs stay
 * single-directed. See specs/M5.md's "The drift graph" for the source list;
 * every id here is verified against CONCEPTS at module load (below). */
const RAW_EDGES: { from: string; to: string; w: number; oneWay?: boolean }[] = [
  { from: 'tree', to: 'wood', w: 3 },
  { from: 'skin', to: 'bark', w: 2 },
  { from: 'wood', to: 'forest', w: 2 },
  { from: 'day', to: 'sun', w: 3 },
  { from: 'moon', to: 'night', w: 1 },
  { from: 'sky', to: 'god', w: 2, oneWay: true },
  { from: 'breath', to: 'spirit', w: 3, oneWay: true },
  { from: 'blood', to: 'kin', w: 2 },
  { from: 'man', to: 'husband', w: 3 },
  { from: 'woman', to: 'wife', w: 3 },
  { from: 'fire', to: 'hearth', w: 2 },
  { from: 'earth', to: 'mud', w: 1 },
  { from: 'earth', to: 'sand', w: 1 },
  { from: 'rain', to: 'cloud', w: 2 },
  { from: 'smoke', to: 'cloud', w: 1 },
  { from: 'tongue', to: 'voice', w: 2 },
  { from: 'hand', to: 'arm', w: 3 },
  { from: 'heart', to: 'breast', w: 1 },
  { from: 'sea', to: 'lake', w: 2 },
  { from: 'mountain', to: 'hill', w: 2 },
  { from: 'star', to: 'luck', w: 1, oneWay: true },
  { from: 'dream', to: 'sleep', w: 2 },
  { from: 'winter', to: 'year', w: 2, oneWay: true },
  { from: 'summer', to: 'year', w: 1, oneWay: true },
  { from: 'hot', to: 'summer', w: 1 },
  { from: 'cold', to: 'winter', w: 1 },
  { from: 'light', to: 'white', w: 2 },
  { from: 'dark', to: 'black', w: 2 },
  { from: 'worm', to: 'snake', w: 2 },
  { from: 'bee', to: 'honey', w: 1 },
  { from: 'cow', to: 'trade', w: 1, oneWay: true },
  { from: 'iron', to: 'knife', w: 1, oneWay: true },
  { from: 'iron', to: 'axe', w: 1, oneWay: true },
  { from: 'chief', to: 'king', w: 2, oneWay: true },
  { from: 'enemy', to: 'slave', w: 1 },
  { from: 'song', to: 'dance', w: 1 },
  { from: 'feast', to: 'gift', w: 1 },
  { from: 'spirit', to: 'god', w: 1, oneWay: true },
  { from: 'eagle', to: 'bird', w: 1, oneWay: true },
  { from: 'bird', to: 'eagle', w: 1, oneWay: true },
  { from: 'child', to: 'son', w: 1 },
  { from: 'child', to: 'daughter', w: 1 },
  { from: 'mouth', to: 'door', w: 1, oneWay: true },
  { from: 'foot', to: 'leg', w: 2 },
  { from: 'finger', to: 'hand', w: 1 },
  { from: 'valley', to: 'river', w: 1 },
  { from: 'morning', to: 'day', w: 1 },
  { from: 'evening', to: 'night', w: 1 },
  { from: 'death', to: 'sleep', w: 1 },
];

export const DRIFT_EDGES: DriftEdge[] = RAW_EDGES.flatMap((e) =>
  e.oneWay ? [{ from: e.from, to: e.to, w: e.w }] : [{ from: e.from, to: e.to, w: e.w }, { from: e.to, to: e.from, w: e.w }],
);

// ------------------------------------------------------------------- taboo

export type TabooEntry = { concept: string; w: number; euphemisms: [string, string][] };

export const TABOO_CONCEPTS: TabooEntry[] = [
  { concept: 'bear', w: 3, euphemisms: [['honey', 'eat'], ['old', 'man']] },
  { concept: 'wolf', w: 3, euphemisms: [['night', 'dog'], ['bad', 'dog']] },
  { concept: 'snake', w: 2, euphemisms: [['earth', 'worm'], ['long', 'worm']] },
  { concept: 'death', w: 2, euphemisms: [['long', 'sleep'], ['go', 'night']] },
  { concept: 'god', w: 1, euphemisms: [['sky', 'father'], ['light', 'king']] },
];

// ----------------------------------------------------------------- coinage

export const REFILL_TEMPLATES: Record<string, [string, string][]> = {
  sun: [['day', 'eye'], ['sky', 'fire']],
  day: [['sun', 'go']],
  moon: [['night', 'sun'], ['night', 'light']],
  night: [['dark', 'sky']],
  spirit: [['breath', 'man']],
  year: [['summer', 'winter']],
  hand: [['finger', 'house']],
  king: [['war', 'father'], ['law', 'chief']],
  sea: [['big', 'water']],
};

/** One anchor concept per domain, used by the generic coinage fallback
 * (specs/M5.md: "fall back to generic [<domain-anchor>, <concept's old
 * word> + diminutive affix]"). Spec-silent choice: picks a common, always-
 * generated root concept per domain that reads naturally in a compound. */
const ANCHOR_BY_DOMAIN: Record<Domain, string> = {
  nature: 'earth',
  body: 'hand',
  kinship: 'people',
  animals: 'wolf',
  'plants/food': 'tree',
  'artifacts/tools': 'stone',
  'society/power': 'king',
  actions: 'go',
  qualities: 'big',
  abstract: 'spirit',
};

// ------------------------------------------------------------- graph integrity

/** specs/M5.md's acceptance criterion 5: verify every id referenced by the
 * drift graph, taboo table, and refill templates exists in CONCEPTS; throw
 * on mismatch at module load. */
function validateGraphIntegrity(): void {
  const known = new Set(CONCEPTS.map((c) => c.id));
  const missing: string[] = [];
  const check = (id: string, where: string): void => {
    if (!known.has(id)) missing.push(`${id} (${where})`);
  };

  for (const e of RAW_EDGES) {
    check(e.from, 'DRIFT_EDGES.from');
    check(e.to, 'DRIFT_EDGES.to');
  }
  for (const t of TABOO_CONCEPTS) {
    check(t.concept, 'TABOO_CONCEPTS.concept');
    for (const [a, b] of t.euphemisms) {
      check(a, 'TABOO_CONCEPTS.euphemisms');
      check(b, 'TABOO_CONCEPTS.euphemisms');
    }
  }
  for (const [concept, templates] of Object.entries(REFILL_TEMPLATES)) {
    check(concept, 'REFILL_TEMPLATES key');
    for (const [a, b] of templates) {
      check(a, 'REFILL_TEMPLATES parts');
      check(b, 'REFILL_TEMPLATES parts');
    }
  }
  for (const anchor of Object.values(ANCHOR_BY_DOMAIN)) check(anchor, 'ANCHOR_BY_DOMAIN');

  if (missing.length > 0) {
    throw new Error(`src/drift.ts: unknown concept id(s) referenced: ${[...new Set(missing)].join(', ')}`);
  }
}

validateGraphIntegrity();

/** Exposed so a unit test can also drive the check explicitly (in addition
 * to it running automatically at import time). */
export function checkGraphIntegrity(): void {
  validateGraphIntegrity();
}

const domainOf = (() => {
  const byId = new Map(CONCEPTS.map((c) => [c.id, c.domain] as const));
  return (id: string): Domain | undefined => byId.get(id);
})();

// --------------------------------------------------------------- coinage build

function currentWordsInUse(workingLexemes: ReadonlyMap<string, Lexeme>): Word[] {
  return [...workingLexemes.values()].map((l) => l.word);
}

/**
 * Coin a replacement word for `concept` from the branch's *current* working
 * lexemes (specs/M5.md's coinage/erosion contract). Tries REFILL_TEMPLATES
 * in order (first whose both parts are currently expressible), then a
 * generic domain-anchor + diminutive-of-old-word compound, then a bare
 * adjective-izer re-derivation of the old word as an absolute last resort.
 *
 * `oldWord` is `concept`'s word immediately before this coinage (the caller
 * has typically already removed `concept` from `workingLexemes` by the time
 * this runs, since a shift's target has just taken over that meaning — so
 * the generic/last-resort fallbacks, which need to re-derive from the old
 * word, take it as an explicit parameter rather than looking it up). */
export function coinReplacement(
  concept: string,
  oldWord: Word | undefined,
  workingLexemes: ReadonlyMap<string, Lexeme>,
  affixes: readonly Affix[],
  inventory: Inventory,
  stream: Stream,
): { word: Word; origin: 'compound' | 'derived'; parts: string[] } {
  const templates = REFILL_TEMPLATES[concept] ?? [];
  for (const [p1, p2] of templates) {
    const a = workingLexemes.get(p1);
    const b = workingLexemes.get(p2);
    if (!a || !b) continue;
    const used = currentWordsInUse(workingLexemes);
    const word = compoundWord(a, b, inventory, stream, used);
    return { word, origin: 'compound', parts: [p1, p2] };
  }

  const domain = domainOf(concept);
  const anchorId = domain ? ANCHOR_BY_DOMAIN[domain] : undefined;
  const anchorLexeme = anchorId ? workingLexemes.get(anchorId) : undefined;
  const diminutive = affixes.find((a) => a.role === 'diminutive');

  if (oldWord && anchorLexeme && diminutive) {
    const used = currentWordsInUse(workingLexemes);
    const oldAsLexeme: Lexeme = { concept, word: oldWord, origin: 'root' };
    const derivedWord = affixDerivedWord(oldAsLexeme, diminutive, inventory, stream, used);
    const derivedAsLexeme: Lexeme = { concept: `${concept}~dim`, word: derivedWord, origin: 'derived', parts: [concept] };
    const word = compoundWord(anchorLexeme, derivedAsLexeme, inventory, stream, used);
    // Display label only (specs/M5.md dict/trace "coined from A + B"):
    // names the *old* word's diminutive derivation, not the (currently
    // nonexistent) concept — clearer than repeating the gapped concept id.
    return { word, origin: 'compound', parts: [anchorId!, `${concept} (little)`] };
  }

  const adjectiveIzer = affixes.find((a) => a.role === 'adjective-izer');
  if (oldWord && adjectiveIzer) {
    const used = currentWordsInUse(workingLexemes);
    const oldAsLexeme: Lexeme = { concept, word: oldWord, origin: 'root' };
    const word = affixDerivedWord(oldAsLexeme, adjectiveIzer, inventory, stream, used);
    return { word, origin: 'derived', parts: [concept] };
  }

  throw new Error(`drift: could not coin a replacement for concept "${concept}" (no old word or affixes available)`);
}

// --------------------------------------------------------------- scheduling

export type DriftConfig = { driftChance: number; tabooChance: number };
export const DEFAULT_DRIFT_CONFIG: DriftConfig = { driftChance: 0.1, tabooChance: 0.02 };

/** Mutable per-branch drift bookkeeping the driver threads through the
 * per-century loop (specs/M5.md's "Rates & scheduling"). Not serialized;
 * derived fresh from a branch's own history at simulation time, mirroring
 * how `liveChanges`/`collapsedRoles` work in src/history.ts. */
export type DriftState = {
  lastDriftCentury: Map<string, number>; // concept -> century of its last shift/extend touch
  tabooed: Set<string>; // concepts already tabooed on this path (permanent)
};

export function initDriftState(): DriftState {
  return { lastDriftCentury: new Map(), tabooed: new Set() };
}

export function cloneDriftState(state: DriftState): DriftState {
  return { lastDriftCentury: new Map(state.lastDriftCentury), tabooed: new Set(state.tabooed) };
}

const RECENCY_WINDOW = 3;

function recentlyDrifted(state: DriftState, concept: string, century: number): boolean {
  const last = state.lastDriftCentury.get(concept);
  return last !== undefined && century - last < RECENCY_WINDOW;
}

function eligibleEdges(
  state: DriftState,
  workingLexemes: ReadonlyMap<string, Lexeme>,
  century: number,
): DriftEdge[] {
  return DRIFT_EDGES.filter((e) => {
    if (!workingLexemes.has(e.from)) return false;
    if (recentlyDrifted(state, e.from, century)) return false;
    if (recentlyDrifted(state, e.to, century)) return false;
    return true;
  });
}

function noteFor(kind: 'shift' | 'extend', from: string, to: string, century: number): string {
  const verb = kind === 'shift' ? 'came to mean' : 'came to also mean';
  return `originally '${from}'; ${verb} '${to}' c. year ${century * 100}`;
}

function tabooNoteFor(concept: string, label: string, century: number): string {
  return `taboo replacement: '${concept}' renamed as ${label}, c. year ${century * 100}`;
}

export type DriftStepResult = {
  events: DriftEvent[];
  reassignments: LexemeReassignment[];
  workingLexemes: Map<string, Lexeme>; // updated (possibly same reference if untouched)
};

/**
 * Run one century's worth of drift/taboo sampling for one branch. Pure
 * given its inputs (all randomness comes from `stream`, the branch's own
 * `drift:<branchId>` stream — specs/M5.md's stream-family requirement).
 * Order: shift/extend roll first, then taboo roll, independently — both
 * draws are consumed unconditionally-in-shape (one `chance` each) so a
 * branch's own drift-stream position never depends on *other* branches'
 * drift outcomes, mirroring src/history.ts's existing split-roll discipline
 * for the sound-change stream.
 */
export function driftStep(
  century: number,
  workingLexemes: Map<string, Lexeme>,
  affixes: readonly Affix[],
  inventory: Inventory,
  driftState: DriftState,
  stream: Stream,
  config: DriftConfig,
): DriftStepResult {
  const events: DriftEvent[] = [];
  const reassignments: LexemeReassignment[] = [];
  let lexemes = workingLexemes;

  const wantsDrift = stream.chance(config.driftChance);
  if (wantsDrift) {
    const candidates = eligibleEdges(driftState, lexemes, century);
    if (candidates.length > 0) {
      const edge = stream.weightedPick(candidates.map((e) => [e, e.w] as const));
      const isShift = stream.chance(0.5); // spec-silent: shift/extend split 50/50
      const fromLexeme = lexemes.get(edge.from)!;
      lexemes = new Map(lexemes);

      if (isShift) {
        // `to` receives `from`'s current word/lineage; `from` is gapped then
        // immediately refilled by coinage.
        lexemes.set(edge.to, { ...fromLexeme, concept: edge.to });
        reassignments.push({
          century,
          concept: edge.to,
          word: { segments: fromLexeme.word.segments, stress: fromLexeme.word.stress },
          cause: 'shift-target',
          sourceConcept: edge.from,
        });
        events.push({ kind: 'shift', century, from: edge.from, to: edge.to, note: noteFor('shift', edge.from, edge.to, century) });

        lexemes.delete(edge.from);
        const coined = coinReplacement(edge.from, fromLexeme.word, lexemes, affixes, inventory, stream);
        lexemes.set(edge.from, { concept: edge.from, word: coined.word, origin: coined.origin, parts: coined.parts });
        reassignments.push({
          century,
          concept: edge.from,
          word: { segments: coined.word.segments, stress: coined.word.stress },
          cause: 'coinage',
          parts: coined.parts,
          origin: coined.origin,
        });
      } else {
        // `to` colexifies with `from`'s current word/lineage; `from` is
        // unaffected (keeps its own word and meaning).
        lexemes.set(edge.to, { ...fromLexeme, concept: edge.to });
        reassignments.push({
          century,
          concept: edge.to,
          word: { segments: fromLexeme.word.segments, stress: fromLexeme.word.stress },
          cause: 'extend-target',
          sourceConcept: edge.from,
        });
        events.push({ kind: 'extend', century, from: edge.from, to: edge.to, note: noteFor('extend', edge.from, edge.to, century) });
      }

      driftState.lastDriftCentury.set(edge.from, century);
      driftState.lastDriftCentury.set(edge.to, century);
    }
  }

  const wantsTaboo = stream.chance(config.tabooChance);
  if (wantsTaboo) {
    const candidates = TABOO_CONCEPTS.filter((t) => !driftState.tabooed.has(t.concept) && lexemes.has(t.concept));
    if (candidates.length > 0) {
      const entry = stream.weightedPick(candidates.map((t) => [t, t.w] as const));
      const [p1, p2] = stream.pick(entry.euphemisms);
      lexemes = lexemes === workingLexemes ? new Map(lexemes) : lexemes;
      const used = currentWordsInUse(lexemes);
      const a = lexemes.get(p1)!;
      const b = lexemes.get(p2)!;
      const word = compoundWord(a, b, inventory, stream, used);
      lexemes.set(entry.concept, { concept: entry.concept, word, origin: 'compound', parts: [p1, p2] });
      reassignments.push({
        century,
        concept: entry.concept,
        word: { segments: word.segments, stress: word.stress },
        cause: 'taboo-coinage',
        parts: [p1, p2],
        origin: 'compound',
      });
      const label = `${p1}-${p2}`;
      events.push({ kind: 'taboo', century, concept: entry.concept, note: tabooNoteFor(entry.concept, label, century) });
      driftState.tabooed.add(entry.concept);
    }
  }

  return { events, reassignments, workingLexemes: lexemes };
}
